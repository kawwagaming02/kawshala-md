const { cmd } = require("../command");
const axios = require("axios");

cmd(
  {
    pattern: "wallp",
    alias: ["wallpaper", "wall"],
    react: "🖼️",
    desc: "🖼️ HD Wallpaper Downloader\nSearch for gorgeous 1080p, 1440p & 4K wallpapers.\nUsage: .wallp <keyword>\nExample: .wallp nature, .wallp anime, .wallp city",
    category: "download",
    filename: __filename,
  },
  async (conn, mek, m, { from, q, reply }) => {
    try {
      if (!q) return reply(`╭─────────────────────╮\n│     🖼️  HD WALLPAPERS      │\n╰─────────────────────╯\n\n❌ *Please provide a keyword!*\n\n📌 Usage: *.wallp <keyword>*\n💡 Example: *.wallp anime*`);

      await conn.sendMessage(from, { react: { text: "⏳", key: mek.key } });
      reply(`🔍 *Searching HD wallpapers for:* _${q}_\n⚡ Please wait a moment...`);

      let wallpapers = [];
      let source = "";

      // ── PRIMARY: Wallhaven ──────────────────────────────
      try {
        const wh = await axios.get(
          `https://wallhaven.cc/api/v1/search?q=${encodeURIComponent(q)}&sorting=random&atleast=1920x1080&resolutions=1920x1080,2560x1440,3840x2160`,
          { timeout: 8000 }
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

      // ── FALLBACK 1: Pexels ──────────────────────────────
      if (!wallpapers.length) {
        try {
          const PEXELS_KEY = "YOUR_PEXELS_API_KEY";
          const px = await axios.get(
            `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=5&orientation=landscape`,
            { headers: { Authorization: PEXELS_KEY }, timeout: 8000 }
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

      // ── FALLBACK 2: Pixabay ─────────────────────────────
      if (!wallpapers.length) {
        try {
          const PIXABAY_KEY = "YOUR_PIXABAY_API_KEY";
          const pb = await axios.get(
            `https://pixabay.com/api/?key=${PIXABAY_KEY}&q=${encodeURIComponent(q)}&image_type=photo&per_page=5&min_width=1920&orientation=horizontal`,
            { timeout: 8000 }
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
        await conn.sendMessage(from, { react: { text: "❌", key: mek.key } });
        return reply(`╭─────────────────────╮\n│    ❌  NOT FOUND       │\n╰─────────────────────╯\n\n*No HD wallpapers found for:* _${q}_\n\n💡 Try different keywords:\n• *.wallp nature*\n• *.wallp anime 4k*\n• *.wallp city night*`);
      }

      // ── HEADER ──────────────────────────────────────────
      const header =
`╔══════════════════════╗
       🖼️  HD WALLPAPERS
╚══════════════════════╝

🔍 Query    ➤  *${q}*
📸 Results  ➤  Top ${wallpapers.length} HD picks
⚡ Source   ➤  ${source}

✨ _Sending your wallpapers..._ 🚀`;

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

      // ── WALLPAPERS LOOP ─────────────────────────────────
      for (let i = 0; i < wallpapers.length; i++) {
        const w = wallpapers[i];
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

        await conn.sendMessage(
          from,
          { image: { url: w.imageUrl }, caption },
          { quoted: mek }
        );
      }

      // ── FOOTER ──────────────────────────────────────────
      await conn.sendMessage(from, { react: { text: "✅", key: mek.key } });
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
      await conn.sendMessage(from, { react: { text: "❌", key: mek.key } });
      reply(`*❌ Error occurred:* ${e.message || e}`);
    }
  }
);
