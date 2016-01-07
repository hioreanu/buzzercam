bcrypt = require('bcrypt-nodejs');

console.log('Encrypted version of ' + process.argv[2] + ':');
console.log(bcrypt.hashSync(process.argv[2]))
