
const { cmd } = require("../command");
const axios = require("axios");

cmd(
  {
    pattern: "wallp",
    alias: ["wallpaper"],
    react: "🖼️",
    desc: "🖼️ HD Wallpaper Downloader\nSearch Wallhaven.cc for gorgeous 1080p, 1440p & 4K wallpapers.\nUsage: .wall <keyword>",
    category: "download",
    filename: __filename,
  },
  async (
    conn,
    mek,
    m,
    {
      from,
      q,
      reply,
    }
  ) => {
    try {
      if (!q) return reply("*🖼️ Please enter a keyword to search HD wallpapers!*");

      reply("*🔍 Searching for HD wallpapers... Please wait a moment.*");

      const res = await axios.get(`https://wallhaven.cc/api/v1/search?q=${encodeURIComponent(q)}&sorting=random&resolutions=1920x1080,2560x1440,3840x2160`);
      const wallpapers = res.data.data;

      if (!wallpapers || wallpapers.length === 0) {
        return reply("*❌ No HD wallpapers found for that keyword.*");
      }

      const selected = wallpapers.slice(0, 5); // get top 5

      const header = `╔══════════════════════╗
      🖼️  HD WALLPAPERS
╚══════════════════════╝
🔍 Query  ➤  *${q}*
📸 Results ➤  Top 5 HD picks
⚡ Source  ➤  Wallhaven.cc

_Sit tight, magic loading..._ ✨`;

// per-wallpaper caption (inside the for loop)
const caption = `╭─────────────────────╮
│  🌅  HD WALLPAPER #${i + 1}  │
╰─────────────────────╯
📐 Resolution ➤ ${wallpaper.resolution}
🎨 Category   ➤ ${wallpaper.category}
🔗 Source     ➤ ${wallpaper.url}

✅ *Right-click → Save Image*`;

// footer reply
return reply(`✅ *All 5 wallpapers sent!*\n\n🌟 Enjoy your new HD walls!\n💡 _Tip: type_ *.wall <keyword>* _for more._\n\n_Thank you for using DANUWA-MD_ 🤖`);

      await conn.sendMessage(
        from,
        {
          image: {
            url: "https://github.com/kawwagaming02/kawshala-md/blob/main/images/KAWSHALA-MD%20(1).jpg?raw=true",
          },
          caption: header,
        },
        { quoted: mek }
      );

      for (const wallpaper of selected) {
        const caption = `
📥 *Resolution:* ${wallpaper.resolution}
🔗 *Link:* ${wallpaper.url}
`;

        await conn.sendMessage(
          from,
          {
            image: { url: wallpaper.path },
            caption,
          },
          { quoted: mek }
        );
      }

      return reply("*🌟 Enjoy your HD wallpapers! Thank you for using DANUWA-MD.*");
    } catch (e) {
      console.error(e);
      reply(`*❌ Error:* ${e.message || e}`);
    }
  }
);


