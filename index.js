const fs = require('fs');
const {statements} = require('./statements');

process.stdout.write(
  JSON.stringify(
    statements(
      JSON.parse(
        fs.readFileSync(0, 'utf-8').toString()
      )
    ), null, 2
   ) + "\n"
);
