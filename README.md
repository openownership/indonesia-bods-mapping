# Indonesia beneficial ownership data BODS mapping

This repo is a short piece of code which gives an example of how you could map
data from [Indonesia's beneficial ownership API](https://panduan.ahu.go.id/api/detail.php)
to the [Beneficial Ownership Data Standard](https://standard.openownership.org).

To run it, you need [node.js](https://nodejs.org) installed, and then to do the
following:

- Clone this repository: `git clone https://github.com/openownership/indonesia-bods-mapping.git`
- Install the required dependencies: `cd indonesia-bods-mapping && npm install`
- Obtain some data (there are examples on the API link above)
- Run the script with node.js: `cat some-sample-data.json | node index.js > output.json`

Your BODS data will then be found in `output.json`. Note that the tool reads
from STDIN and writes to STDOUT so it can be used in other commandline scripts.

## Mapping approach

The original data is structured as a series of 'transactions' which we assume to
include a complete set of every ownership at the time of disclosure. We
therefore replace statements from older transactions with those from newer ones,
if identifiers of the people & entities involved match.

No unique identifier is given which could substitute for a statementID so we
generate one by hashing the available data for each statement type that makes
them unqiue. This is:

- Company statement: name, address
- Person statement: name, address, identifiers, source
- Ownership or control statement: person statement id, company statement id, ownership details, source

Specifically, we don't include the source in our company statement identifiers
because it's our understanding that while each transaction might be made by a
different person or notary, no company information is actually divulged in this
process - it comes from the central register. It therefore results in clearer
data if the entity statement is always the same across all transactions.

For simplicity, all statements are marked as if they were published by the same
government agency that produces the original data. In reality, we would likely
want to denote that some transformation has taken place via annotations and an
alternative publisher.

## Caveats

We have only been able to base this code on a single (thorough) example and our
knowledge of the data collection process. Therefore, assumptions about which
fields can be relied on might break down with other data.

We've tried to produce a reasonable mapping which preserves the fidelity of the
original source, whilst translating it to high-quality BODS. However, there are
several issues:

1. BODS has no way to record identifiers of `Agent`s who make statements, so while
   the original data reports them, we do not include them in BODS.
2. No information is given about the type of ownership, when it starts/ends or
   about the interests which make it up, so we cannot map it
3. Companies do not report a registration number, it is our understanding that
   company names are strictly controlled in Indonesia and are therefore unique
   enough to serve as identifiers in their own right.
4. Individual 'transactions' are not dated, only numbered, so we report this
   number in the `source` description but cannot give a meaningful
   `statementDate`.
