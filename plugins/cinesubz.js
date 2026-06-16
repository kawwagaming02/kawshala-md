const { cmd } = require("../command");
const { searchCineSubz, scrapeCineSubz, scrapeCineSubzServerLink } = require('cinesubz-scraper');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Session storage
const pendingSearch = {};
const pendingDownload = {};

// ============ DOWNLOAD AND SEND MOVIE FUNCTION ============
async function downloadAndSendMovie(client, from, movieUrl, quality, m) {
    try {
        // Step 1: Get movie details
        const details = await scrapeCineSubz(movieUrl);
        
        if (!details.downloadLinks || details.downloadLinks.length === 0) {
            return { success: false, message: "No download links found" };
        }

        // Step 2: Find the requested quality
        let selectedLink = null;
        for (const link of details.downloadLinks) {
            if (link.quality && link.quality.toLowerCase().includes(quality.toLowerCase())) {
                selectedLink = link;
                break;
            }
        }

        // If exact quality not found, get best available
        if (!selectedLink) {
            const priority = ['1080p', '720p', '480p'];
            for (const q of priority) {
                for (const link of details.downloadLinks) {
                    if (link.quality && link.quality.toLowerCase().includes(q)) {
                        selectedLink = link;
                        break;
                    }
                }
                if (selectedLink) break;
            }
        }

        // If still no link, take the first one
        if (!selectedLink) {
            selectedLink = details.downloadLinks[0];
        }

        // Step 3: Get direct download URL
        let downloadUrl = selectedLink.url || selectedLink.link;
        
        // Get direct link if it's a server link
        if (downloadUrl && (downloadUrl.includes('/go/') || downloadUrl.includes('/server/'))) {
            try {
                const directLink = await scrapeCineSubzServerLink(downloadUrl);
                if (directLink) {
                    downloadUrl = directLink;
                }
            } catch (e) {
                console.log("Could not get direct link, using original");
            }
        }

        // Step 4: Download the file
        const fileName = `${details.title || 'movie'} - ${selectedLink.quality || 'HD'}.mp4`.replace(/[^\w\s.-]/gi, '');
        const filePath = path.join(__dirname, 'temp', fileName);
        
        // Create temp directory if not exists
        if (!fs.existsSync(path.join(__dirname, 'temp'))) {
            fs.mkdirSync(path.join(__dirname, 'temp'));
        }

        // Send progress message
        await client.sendMessage(from, {
            text: `📥 *Downloading ${details.title}*\n📊 Quality: ${selectedLink.quality || 'HD'}\n💾 Size: ${selectedLink.size || 'Unknown'}\n\n⏳ Please wait...`
        }, { quoted: m });

        // Download the file
        const response = await axios({
            method: 'GET',
            url: downloadUrl,
            responseType: 'stream',
            timeout: 600000, // 10 minutes timeout
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', async () => {
                try {
                    // Step 5: Send the file to WhatsApp
                    await client.sendMessage(from, {
                        document: {
                            url: filePath
                        },
                        mimetype: "video/mp4",
                        fileName: fileName,
                        caption: `🎬 *${details.title}*\n📊 ${selectedLink.quality || 'HD'}\n💾 ${selectedLink.size || 'N/A'}\n\n*Enjoy the movie! 🍿*`
                    }, { quoted: m });

                    // Step 6: Clean up temp file
                    fs.unlinkSync(filePath);
                    
                    resolve({ success: true, message: "Movie sent successfully!" });
                } catch (error) {
                    reject(error);
                }
            });

            writer.on('error', (error) => {
                reject(error);
            });
        });

    } catch (error) {
        console.error("Download error:", error);
        return { success: false, message: error.message || "Download failed" };
    }
}

// ============ COMMAND: DOWNLOAD MOVIE ============
cmd({
    pattern: "d",
    alias: ["download", "get", "dl"],
    react: "📥",
    desc: "Download movie from CineSubz",
    category: "download",
    filename: __filename
}, async (client, message, m, { from, q, sender, reply }) => {
    if (!q) {
        return reply(`📥 *Movie Downloader*

*Usage:*
• d movie_name
• download movie_name
• dl movie_name

*Examples:*
• d captain america
• download inception
• dl avatar

*You can also specify quality:*
• d avatar 1080p
• d inception 720p`);
    }

    await client.sendMessage(from, { 
        react: { text: "⏳", key: m.key } 
    });

    // Parse command: "d movie_name quality"
    const parts = q.trim().split(/\s+/);
    const movieName = parts[0];
    const quality = parts[1] || '1080p';

    reply(`🔍 *Searching for "${movieName}"...*`);

    try {
        // Search for the movie
        const results = await searchCineSubz(movieName);
        
        if (!results || results.length === 0) {
            return reply(`❌ *No movies found for "${movieName}"*`);
        }

        // Get the first result
        const movie = results[0];
        
        // Download and send
        const result = await downloadAndSendMovie(
            client, 
            from, 
            movie.url || movie.movieUrl, 
            quality,
            m
        );

        if (!result.success) {
            reply(`❌ *Download failed:* ${result.message}`);
        }

    } catch (error) {
        console.error("Command error:", error);
        reply(`❌ *Error:* ${error.message || 'Unknown error'}`);
    }
});

// ============ COMMAND: DOWNLOAD WITH SELECTION ============
cmd({
    pattern: "ds",
    alias: ["dselect", "dls"],
    react: "🎬",
    desc: "Search and select movie to download",
    category: "download"
}, async (client, message, m, { from, q, sender, reply }) => {
    if (!q) {
        return reply(`🎬 *Search and Download*

*Usage:*
• ds movie_name

*Example:*
• ds captain america`);
    }

    await client.sendMessage(from, { 
        react: { text: "⏳", key: m.key } 
    });

    reply(`🔍 *Searching for "${q}"...*`);

    try {
        const results = await searchCineSubz(q);
        
        if (!results || results.length === 0) {
            return reply(`❌ *No movies found for "${q}"*`);
        }

        // Store results
        pendingSearch[sender] = { 
            results: results, 
            timestamp: Date.now(),
            action: 'download'
        };

        let msg = `*🎬 Select a movie to download:*\n\n`;
        const displayCount = Math.min(10, results.length);
        
        for (let i = 0; i < displayCount; i++) {
            const movie = results[i];
            msg += `*${i+1}.* ${movie.title || 'N/A'}\n`;
            msg += `   📊 ${movie.quality || 'N/A'}\n`;
            msg += `   📝 ${movie.language || 'N/A'}\n\n`;
        }
        
        msg += `*📌 Type the number (1-${displayCount})*\n`;
        msg += `⏱️ *Session expires in 5 minutes*`;

        await client.sendMessage(from, { text: msg }, { quoted: m });

    } catch (error) {
        console.error("Search error:", error);
        reply(`❌ *Error:* ${error.message || 'Unknown error'}`);
    }
});

// ============ HANDLE MOVIE SELECTION FOR DOWNLOAD ============
cmd({
    filter: (text, { sender }) => {
        if (!pendingSearch[sender]) return false;
        if (pendingSearch[sender].action !== 'download') return false;
        const num = parseInt(text.trim());
        return !isNaN(num) && num > 0 && num <= pendingSearch[sender].results.length;
    }
}, async (client, message, m, { body, sender, reply, from }) => {
    await client.sendMessage(from, { 
        react: { text: "✅", key: m.key } 
    });

    const index = parseInt(body.trim()) - 1;
    const selected = pendingSearch[sender].results[index];
    
    // Ask for quality
    pendingDownload[sender] = {
        movie: selected,
        timestamp: Date.now()
    };

    let msg = `*🎬 ${selected.title}*\n\n`;
    msg += `*Select quality:*\n`;
    msg += `1. 1080p (Best)\n`;
    msg += `2. 720p (Good)\n`;
    msg += `3. 480p (Small)\n\n`;
    msg += `*📌 Type the number (1-3)*`;

    await client.sendMessage(from, { text: msg }, { quoted: m });
});

// ============ HANDLE QUALITY SELECTION ============
cmd({
    filter: (text, { sender }) => {
        if (!pendingDownload[sender]) return false;
        const num = parseInt(text.trim());
        return !isNaN(num) && num >= 1 && num <= 3;
    }
}, async (client, message, m, { body, sender, reply, from }) => {
    await client.sendMessage(from, { 
        react: { text: "⏳", key: m.key } 
    });

    const qualities = ['1080p', '720p', '480p'];
    const quality = qualities[parseInt(body.trim()) - 1];
    const { movie } = pendingDownload[sender];

    // Download and send
    const result = await downloadAndSendMovie(
        client, 
        from, 
        movie.url || movie.movieUrl, 
        quality,
        m
    );

    if (!result.success) {
        reply(`❌ *Download failed:* ${result.message}`);
    }

    delete pendingDownload[sender];
    delete pendingSearch[sender];
});

// ============ COMMAND: GET DOWNLOAD LINK ONLY ============
cmd({
    pattern: "link",
    alias: ["getlink", "gl"],
    react: "🔗",
    desc: "Get movie download link only",
    category: "download"
}, async (client, message, m, { from, q, sender, reply }) => {
    if (!q) {
        return reply(`🔗 *Get Download Link*

*Usage:*
• link movie_name
• getlink movie_name

*Example:*
• link captain america`);
    }

    await client.sendMessage(from, { 
        react: { text: "⏳", key: m.key } 
    });

    reply(`🔍 *Searching for "${q}"...*`);

    try {
        const results = await searchCineSubz(q);
        
        if (!results || results.length === 0) {
            return reply(`❌ *No movies found for "${q}"*`);
        }

        const movie = results[0];
        const details = await scrapeCineSubz(movie.url || movie.movieUrl);

        let msg = `🔗 *Download Links for ${details.title}*\n\n`;
        
        if (details.downloadLinks && details.downloadLinks.length > 0) {
            details.downloadLinks.forEach((link, i) => {
                msg += `*${i+1}.* ${link.quality || 'N/A'} - ${link.size || 'N/A'}\n`;
                msg += `   Server: ${link.server || 'Direct'}\n`;
                msg += `   URL: ${link.url || link.link || 'N/A'}\n\n`;
            });
        } else {
            msg += `*❌ No download links available*`;
        }

        await client.sendMessage(from, { text: msg }, { quoted: m });

    } catch (error) {
        console.error("Link error:", error);
        reply(`❌ *Error:* ${error.message || 'Unknown error'}`);
    }
});

// ============ COMMAND: DIRECT DOWNLOAD BY URL ============
cmd({
    pattern: "durl",
    alias: ["downloadurl", "dlink"],
    react: "📌",
    desc: "Download movie directly from URL",
    category: "download"
}, async (client, message, m, { from, q, sender, reply }) => {
    if (!q) {
        return reply(`📌 *Direct Download by URL*

*Usage:*
• durl movie_url
• downloadurl movie_url

*Example:*
• durl https://cinesubz.com/movie/captain-america-2011

*You can also specify quality:*
• durl url 1080p`);
    }

    await client.sendMessage(from, { 
        react: { text: "⏳", key: m.key } 
    });

    const parts = q.trim().split(/\s+/);
    const url = parts[0];
    const quality = parts[1] || '1080p';

    if (!url.startsWith('http')) {
        return reply(`❌ *Invalid URL!*\nPlease provide a valid CineSubz URL.`);
    }

    reply(`📥 *Downloading...*`);

    const result = await downloadAndSendMovie(
        client, 
        from, 
        url, 
        quality,
        m
    );

    if (!result.success) {
        reply(`❌ *Download failed:* ${result.message}`);
    }
});

// ============ AUTO CLEANUP ============
setInterval(() => {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes
    
    for (const sender in pendingSearch) {
        if (now - pendingSearch[sender].timestamp > timeout) {
            delete pendingSearch[sender];
        }
    }
    
    for (const sender in pendingDownload) {
        if (now - pendingDownload[sender].timestamp > timeout) {
            delete pendingDownload[sender];
        }
    }
}, 2 * 60 * 1000);

// ============ EXPORT ============
module.exports = { 
    pendingSearch, 
    pendingDownload 
};
