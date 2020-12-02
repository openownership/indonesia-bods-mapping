const XXHash = require('xxhash');
const countries = require('i18n-iso-countries');
const { v4: uuidv4 } = require('uuid');

// Generate a statementID for some data
// We don't see any unique id numbers in the data itself and because we're just
// transforming existing data we can't persist any new ones (e.g. a UUID we
// generate). Instead we use a hash of the data itself + a namespace, because
// that allows us to recognise that statements are the same between
// 'transactions' if none of the data changes.
function statementID(data) {
  const hash = XXHash.hash(Buffer.from(JSON.stringify(data), 'utf-8'), 0xCAFEBABE);
  return `openownership-indonesia-${hash}`;
}

// These are the same for all statements
function publicationDetails() {
  return {
    publicationDate: new Date().toISOString().split('T')[0],
    bodsVersion: '0.2',
    publisher: {
      name: "Indonesia Ministry for Law and Human Rights",
    }
  };
}

// These look mostly the same for all different kinds of statements
function source(data) {
  return {
    type: [data['jenis_pelapor'] === 'KORPORASI' ? 'thirdParty' : 'selfDeclaration'],
    retrievedAt: new Date().toISOString(),
    url: 'https://bo.ahu.go.id/service/getReportBo',
    assertedBy: [{
      name: data['jenis_pelapor'] === 'KORPORASI' ? data['nama_pelapor'] : data['nama_pic']
    }]
  }
}

function mapAddress(data, foreign, country_code) {
  if (foreign) {
    return {
      type: 'residence',
      address: [data['alamat'], data['negara']].filter((obj) => obj).join(", "),
      country: country_code || ''
    }
  } else {
    return {
      type: 'residence',
      address: [data['alamat'], data['rt'], data['rw'], data['kelurahan'], data['kecamatan'], data['kabupaten'], data['provinisi'], 'Indonesia'].filter((obj) => obj).join(", "),
      country: 'ID'
    }
  }
}

function companyIdentifier(data) {
  return {
    scheme: 'ID-KHH',
    schemeName: 'Ministry of Justice & Human Rights',
    id: data['nama_korporasi']
  }
}

function mapCompanyStatement(data, companyLocation, sourceData) {
  return {
    statementID: statementID([data, companyLocation]),
    statementType: 'entityStatement',
    isComponent: false,
    entityType: 'registeredEntity',
    name: data['nama_korporasi'],
    incorporatedInJurisdiction: {
      name: 'Indonesia',
      code: 'ID'
    },
    identifiers: [
      companyIdentifier(data)
    ],
    addresses: [
      {
        type: 'registered',
        address: companyLocation,
        country: 'ID'
      }
    ],
    source: source(sourceData),
    publicationDetails: publicationDetails()
  }
}

function mapPersonStatement(data, sourceData) {
  let country_code = 'ID'
  if(data['kewarganegaraan'] === 'WNA') {
    country_code = countries.getAlpha2Code(data['negara'].trim(), "en");
  }
  return {
    statementID: statementID([data, sourceData]),
    statementType: 'personStatement',
    isComponent: false,
    personType: 'knownPerson',
    names: [
      {
        type: 'individual',
        fullName: data['nama_lengkap'],
      }
    ],
    birthDate: data['tanggal_lahir'],
    placeOfBirth: {
      type: 'placeOfBirth',
      address: data['tempat_lahir']
    },
    nationalities: [
      {
        name: data['kewarganegaraan'] === 'WNI' ? 'Indonesia' : data['negara'],
        code: country_code
      }
    ],
    identifiers: [
      {
        scheme: 'ID-DJP',
        schemeName: 'Director General of Taxes',
        id: data['npwp']
      },
      {
        scheme: `MISC-ID-${data['jenis_identitas']}`,
        schemeName: data['jenis_identitas'],
        id: data['nomor_identitas']
      }
    ],
    addresses: [
      mapAddress(data, data['kewarganegaraan'] === 'WNA', country_code)
    ],
    source: source(sourceData),
    publicationDetails: publicationDetails()
  }
}

function mapOwnershipOrControlStatement(companyStatement, personStatement, data, sourceData) {
  return {
    statementID: statementID([
      companyStatement.statementID,
      personStatement.statementID,
      data,
      sourceData
    ]),
    statementType: 'ownershipOrControlStatement',
    isComponent: false,
    subject: {
      describedByEntityStatement: companyStatement.statementID
    },
    interestedParty: {
      describedByPersonStatement: personStatement.statementID
    },
    interests: [
      {
        type: 'other-influence-or-control',
        details: data['hubungan_bo'],
        interestLevel: 'direct',
        beneficialOwnershipOrControl: true
      }
    ],
    source: source(sourceData),
    publicationDetails: publicationDetails()
  }
}

function matchingIdentifiers(newStatement, oldStatement) {
  return newStatement.identifiers.some((id) => {
    return oldStatement.identifiers.some(oldId => oldId.scheme === id.scheme && oldId.id === id.id);
  });
}

function replacedStatements(newStatement, oldStatements) {
  return oldStatements.filter((oldStatement) => {
    return (
      oldStatement.statementType === newStatement.statementType
        && matchingIdentifiers(newStatement, oldStatement)
    );
  })
  .map(s => s.statementID);
}

function replacedOwnershipStatements(newStatement, newInterestedParty, newSubject, oldStatements) {
  // When comparing ownership statements, we need to compare the entities &
  // people they connect.
  // For a production system, you'd probably have these indexed in some kind
  // of data structure so that you could look them up, but in this demo we're
  // just scanning the whole list for them each time.
  return oldStatements.filter((s) => {
    if (s.statementType === newStatement.statementType) {
      oldInterestedParty = oldStatements.find(sp => sp.statementID === s.interestedParty.describedByPersonStatement);
      oldSubject = oldStatements.find(sp => sp.statementID === s.subject.describedByEntityStatement);

      return (
        matchingIdentifiers(newInterestedParty, oldInterestedParty)
          && matchingIdentifiers(newSubject, oldSubject)
      )
    }
    return false;
  })
  .map(s => s.statementID);
}

function statements(data) {
  // We don't want to output duplicate statements, so we need to keep track of
  // statements we've seen before as we go through each 'transaction'.
  const seenStatementIds = new Set();

  // This is only given at the top level, but it's useful to output with each
  // company statement as an address, so we pull it out now
  const companyLocation = data['data']['kedudukan'];

  // Every transaction completely replaces the previous transaction in the sense
  // that the entire set of owners is included every time.
  // This allows us to mark changes using BODS' replacesStatements easily,
  // because we just have to look at the previous transaction to see if any data
  // was updated.
  // We can use the following heuristics to find changed statements:
  // - Company statements / Person statements: any matching identifier
  // - Ownership statements: any matching identifier on both sides of the relationship
  // To do that, we need to keep track of the statements in the previous
  // transactions
  let prevTransactionStatements = [];

  return data['data']['data_transaksi'].flatMap((transaction) => {
    const transactionStatements = [];
    const newStatements = [];

    const sourceData = Object.assign({}, transaction);
    delete sourceData['data_bo'];
    delete sourceData['nama_korporasi'];
    delete sourceData['jenis_transaksi'];

    const companyData = {'nama_korporasi': transaction['nama_korporasi']};
    companyStatement = mapCompanyStatement(companyData, companyLocation, sourceData);
    transactionStatements.push(companyStatement);
    if (!seenStatementIds.has(companyStatement['statementID'])) {
      seenStatementIds.add(companyStatement['statementID']);
      // Since this is a new statement, does it replace any previous statements?
      companyStatement.replacesStatements = replacedStatements(companyStatement, prevTransactionStatements)
      newStatements.push(companyStatement);
    }

    // Each 'data_bo' object represents a person (owner) and their relationship]
    // to the company
    transaction['data_bo'].forEach((bo_datum) => {
      const personData = Object.assign({}, bo_datum);
      delete personData['hubungan_bo'];
      personStatement = mapPersonStatement(personData, sourceData);
      transactionStatements.push(personStatement);
      if (!seenStatementIds.has(personStatement['statementID'])) {
        seenStatementIds.add(personStatement['statementID']);
        // Since this is a new statement, does it replace any previous statements?
        personStatement.replacesStatements = replacedStatements(personStatement, prevTransactionStatements)
        newStatements.push(personStatement);
      }

      ownershipOrControlStatement = mapOwnershipOrControlStatement(
        companyStatement,
        personStatement,
        bo_datum,
        sourceData
      );
      transactionStatements.push(ownershipOrControlStatement);
      if (!seenStatementIds.has(ownershipOrControlStatement['statementID'])) {
        seenStatementIds.add(ownershipOrControlStatement['statementID']);
        // Since this is a new statement, does it replace any previous statements?
        ownershipOrControlStatement.replacesStatements = replacedOwnershipStatements(ownershipOrControlStatement, personStatement, companyStatement, prevTransactionStatements)
        newStatements.push(ownershipOrControlStatement);
      }
    });

    // Any ownerships which are no longer present and which weren't replaced
    // can be assumed to be ended, so add a new statement to do that with a
    // notional end date of today.
    prevTransactionStatements
      .filter(ps => ps.statementType === 'ownershipOrControlStatement')
      .forEach((ps) => {
        if(!transactionStatements.find(s => s.statementID === ps.statementID)
            && !transactionStatements.find(s => s.replacesStatements && s.replacesStatements.includes(ps.statementID))
          ){
            endingStatement = Object.assign({}, ps);
            endingStatement.statementID = uuidv4();
            endingStatement.interests[0].endDate = new Date().toISOString().split('T')[0];
            endingStatement.replacesStatements = [ps.statementID];
            newStatements.push(endingStatement);
          }
      });

    prevTransactionStatements = transactionStatements;

    return newStatements;
  });
}

exports.statements = statements;
