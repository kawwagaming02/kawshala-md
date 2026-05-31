const { cmd } = require("../command");

cmd(
  {
    pattern: "menu",
    desc: "Displays all available commands",
    category: "main",
    filename: __filename,
  },
  async (kawshala, mek, m, { reply }) => {
    try {
      let menuText = `╭━〔 KAWSHALA-MD 〕━··๏
┃ 👑 *𝐎𝐰𝐧𝐞𝐫 :* kawshala-md
┃ ⚙️ *𝐌𝐨𝐝𝐞 :* PUBLIC
┃ 🔣 *𝐏𝐫𝐞𝐟𝐢𝐱 :* .
┃ 📚 *𝐂𝐨𝐦𝐦𝐚𝐧𝐝𝐬 :* 115
╰━━━━━━━━━━━━━━┈⊷
╭━〔 *𝐒𝐘𝐒𝐓𝐄𝐌 𝐒𝐓𝐀𝐓𝐒* 〕━··๏
┃ ⏱ *𝐔𝐩𝐭𝐢𝐦𝐞 :* 59 minutes, 
┃ 🚀 *𝐋𝐚𝐭𝐞𝐧𝐜𝐲 :* 440ms
┃ 💻 *𝐏𝐥𝐚𝐭𝐟𝐨𝐫𝐦 :* Heroku
┃ 🤖 *𝐕𝐞𝐫𝐬𝐢𝐨𝐧 :* 1.0.2
╰━━━━━━━━━━━━━━┈⊷

╭━━〔 📜 𝐌𝐄𝐍𝐔 𝐋𝐈𝐒𝐓 〕━━┈⊷
┃ 1️⃣  DOWNLOAD (29)
┃ 2️⃣  LOGO (27)
┃ 3️⃣  MAIN (19)
┃ 4️⃣  MEDIA (7)
┃ 5️⃣  TOOLS (32)
╰━━━━━━━━━━━━━━┈⊷

_💡 Reply with number to select._`;

      await reply(menuText);
    } catch (err) {
      console.error(err);
      reply("❌ Error generating menu.");
    }
  }
);
