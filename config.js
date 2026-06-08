const fs = require('fs');
if (fs.existsSync('config.env')) require('dotenv').config({ path: './config.env' });

function convertToBool(text, fault = 'true') {
    return text === fault ? true : false;
}
module.exports = {
SESSION_ID: process.env.SESSION_ID || "EYNkTIDZ#ULk_Htq-tF16JtFkxSZELjAprezR4Jz0v1avylzTNKU",
ALIVE_IMG: process.env.ALIVE_IMG || "https://github.com/kawwagaming02/kawshala-md/blob/main/images/KAWSHALA-MD%20(1).jpg?raw=true",
ALIVE_MSG: process.env.ALIVE_MSG || "*Hello👋 KAWSHALA-MD Is Alive Now😍*",
BOT_OWNER: '94710189823',  // Replace with the owner's phone number



};
