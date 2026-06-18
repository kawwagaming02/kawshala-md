const { cmd } = require("../command");
const axios = require("axios");

const pendingPL = {};

cmd({
  pattern: "piratelk",
  alias: ["pirate", "plk"],
  react: "🏴‍☠️",
  desc: "Search movies from Piratelk.com",
  category: "download",
  filename: __filename
}, async (danuwa, mek, m, { from, q, sender, reply }) => {
  if (!q) return reply("*🏴‍☠️ Usage:* .pirate <movie_name>");
  reply("*🔍 Searching PirateLK database...*");

  try {
    const { data } = await axios.get(`https://piratelk.com/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=10`);
    if (!data || data.length === 0) return reply("*❌ No posts found on PirateLK!*");

    pendingPL[sender] = data;
    let txt = "*🏴‍☠️ PirateLK Search Results:*\n\n";
    data.forEach((mv, i) => {
      txt += `*${i+1}.* ${mv.title.rendered.replace(/&#8211;/g, "-").replace(/&#8217;/g, "'")}\n`;
    });
    txt += `\n*Reply with the number to get download post link.*`;
    reply(txt);
  } catch (e) {
    reply("*❌ Error connecting to PirateLK API!*");
  }
});

cmd({
  filter: (text, { sender }) => pendingPL[sender] && !isNaN(text) && parseInt(text) <= pendingPL[sender].length
}, async (danuwa, mek, m, { body, sender, reply }) => {
  const selected = pendingPL[sender][parseInt(body) - 1];
  delete pendingPL[sender];
  reply(`*🏴‍☠️ ${selected.title.rendered.replace(/&#8211;/g, "-")}*\n\n🌐 *Post URL:* ${selected.link}`);
});
