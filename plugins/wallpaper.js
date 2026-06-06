const { cmd } = require("../command");
const axios = require("axios");

// ── Safe send with retry ─────────────────────────────────
async function safeSend(conn, from, content, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await conn.sendMessage(from, content, options);
    } catch (err) {
      const isConnErr = err?.output?.statusCode === 428 || 
                        err?.message?.includes("Connection Closed");
      if (isConnErr && i < retries - 1) {
        await new Promise(r => setTimeout(r, 3000)); // wait 3s then retry
        continue;
      }
      throw err;
    }
  }
}

cmd(
  {
    pattern: "wallp",
    alias: ["wallpaper", "wall"],
    react: "🖼️",
    desc: "🖼️ HD Wallpaper Downloader\nSearch for gorgeous 1080p, 1440p & 4K wallpapers.\nUsage: .wallp <keyword>",
    category: "download",
    filename: __filename,
  },
  async (conn, mek, m, { from, q, reply }) => {
    try {
      if (!q) return reply(`╭─────────────────────╮\n│     🖼️  HD WALLPAPERS      │\n╰─────────────────────╯\n\n❌ *Please provide a keyword!*\n\n📌 Usage: *.wallp <keyword>*\n💡 Example: *.wallp anime*`);

      await safeSend(conn, from, { react: { text: "⏳", key: mek.key } });
      reply(`🔍 *Searching HD wallpapers for:* _${q}_\n⚡ Please wait...`);

      let wallpapers = [];
      let source = "";

      // ── PRIMARY: Wallhaven ───────────────────────────────
      try {
        const wh = await axios.get(
          `https://wallhaven.cc/api/v1/search?q=${encodeURIComponent(q)}&sorting=random&atleast=1920x1080&resolutions=1920x1080,2560x1440,3840x2160`,
          { timeout: 10000 }
        );
        const data = wh.data?.data || [];
        if (data.length > 0) {
          wallpapers = data.slice(0, 5).map((w) => ({
            imageUrl: w.path,
            resolution: w.resolution,
            category: w.category || "General",
            pageUrl: w.url,
          }));
          source = "Wallhaven.cc";
        }
      } catch (_) {}

      // ── FALLBACK 1: Pexels ───────────────────────────────
      if (!wallpapers.length) {
        try {
          const PEXELS_KEY = "Tnz52I0wE9Kel1HyNhEg0J8xm4C8BEipOdHYYywGv7TN1JeaO3ry4MfQ";
          const px = await axios.get(
            `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=5&orientation=landscape`,
            { headers: { Authorization: PEXELS_KEY }, timeout: 10000 }
          );
          const photos = px.data?.photos || [];
          if (photos.length > 0) {
            wallpapers = photos.map((p) => ({
              imageUrl: p.src.original,
              resolution: `${p.width}x${p.height}`,
              category: "Photography",
              pageUrl: p.url,
            }));
            source = "Pexels.com";
          }
        } catch (_) {}
      }

      // ── FALLBACK 2: Pixabay ──────────────────────────────
      if (!wallpapers.length) {
        try {
          const PIXABAY_KEY = "56196591-2346e71cad1a674b6dd3df7f5";
          const pb = await axios.get(
            `https://pixabay.com/api/?key=${PIXABAY_KEY}&q=${encodeURIComponent(q)}&image_type=photo&per_page=5&min_width=1920&orientation=horizontal`,
            { timeout: 10000 }
          );
          const hits = pb.data?.hits || [];
          if (hits.length > 0) {
            wallpapers = hits.map((h) => ({
              imageUrl: h.largeImageURL,
              resolution: `${h.imageWidth}x${h.imageHeight}`,
              category: h.type || "Photo",
              pageUrl: h.pageURL,
            }));
            source = "Pixabay.com";
          }
        } catch (_) {}
      }

      if (!wallpapers.length) {
        await safeSend(conn, from, { react: { text: "❌", key: mek.key } });
        return reply(`❌ *No HD wallpapers found for:* _${q}_\n\n💡 Try: *.wallp nature* or *.wallp anime 4k*`);
      }

      // ── HEADER ───────────────────────────────────────────
      const header =
`╔══════════════════════╗
       🖼️  HD WALLPAPERS
╚══════════════════════╝

🔍 Query    ➤  *${q}*
📸 Results  ➤  Top ${wallpapers.length} HD picks
⚡ Source   ➤  ${source}

✨ _Sending your wallpapers..._ 🚀`;

      await safeSend(
        conn, from,
        {
          image: { url: "https://github.com/kawwagaming02/kawshala-md/blob/main/images/KAWSHALA-MD%20(1).jpg?raw=true" },
          caption: header,
        },
        { quoted: mek }
      );

      // ── WALLPAPERS LOOP ──────────────────────────────────
      for (let i = 0; i < wallpapers.length; i++) {
        const w = wallpapers[i];

        // small delay between sends — prevents connection overload
        if (i > 0) await new Promise(r => setTimeout(r, 1500));

        const caption =
`╭─────────────────────╮
│   🌅  WALLPAPER ${i + 1} of ${wallpapers.length}   │
╰─────────────────────╯

📐 *Resolution* ➤ ${w.resolution}
🎨 *Category*   ➤ ${w.category}
🌐 *Source*     ➤ ${source}
🔗 *View Full*  ➤ ${w.pageUrl}

💾 _Long press → Save to Gallery_
⭐ _Enjoy your wallpaper!_`;

        await safeSend(
          conn, from,
          { image: { url: w.imageUrl }, caption },
          { quoted: mek }
        );
      }

      // ── FOOTER ───────────────────────────────────────────
      await safeSend(conn, from, { react: { text: "✅", key: mek.key } });
      return reply(
`╭─────────────────────╮
│     ✅  ALL DONE!      │
╰─────────────────────╯

🌟 *${wallpapers.length} HD wallpapers delivered!*
🔁 Use *.wallp <keyword>* for more

⚡ _KAWSHALA-MD — Always Fast, Always HD_ 🤖`
      );

    } catch (e) {
      console.error("❌ Wallpaper Error:", e);
      try {
        await safeSend(conn, from, { react: { text: "❌", key: mek.key } });
      } catch (_) {}
      reply(`*❌ Error:* ${e.message || e}`);
    }
  }
);
