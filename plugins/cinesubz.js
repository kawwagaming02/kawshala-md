const { cmd } = require("../command");
const { searchCineSubz, scrapeCineSubz, scrapeCineSubzServerLink } = require('cinesubz-scraper');

// Session storage
const pendingSearch = {};
const pendingDownload = {};

// ============ MAIN SEARCH COMMAND ============
cmd({
    pattern: "cs",
    alias: ["cinesubz", "movie", "film"],
    react: "🎬",
    desc: "Search and download movies from CineSubz",
    category: "download",
    filename: __filename
}, async (danuwa, mek, m, { from, q, sender, reply }) => {
    if (!q) {
        return reply(`🎬 *CineSubz Movie Downloader*

*Usage:*
• cs movie_name
• cinesubz movie_name
• movie movie_name

*Examples:*
• cs avatar
• cinesubz inception
• movie kumari`);
    }

    await danuwa.sendMessage(from, { 
        react: { text: "⏳", key: m.key } 
    });

    reply("*🔍 Searching for movies on CineSubz...*");

    try {
        const results = await searchCineSubz(q);
        
        if (!results || results.length === 0) {
            return reply("❌ *No movies found!*\n\nTry with different keywords.");
        }

        // Store results for this user
        pendingSearch[sender] = { 
            results: results, 
            timestamp: Date.now() 
        };

        let msg = "*🎬 Search Results:*\n\n";
        const displayCount = Math.min(10, results.length);
        
        for (let i = 0; i < displayCount; i++) {
            const movie = results[i];
            msg += `*${i+1}.* ${movie.title || 'N/A'}\n`;
            msg += `   📊 Quality: ${movie.quality || 'N/A'}\n`;
            msg += `   📝 Language: ${movie.language || 'N/A'}\n`;
            msg += `   📅 Year: ${movie.year || 'N/A'}\n\n`;
        }
        
        msg += `*📌 Type a number (1-${displayCount})*\n`;
        msg += `⏱️ *Session expires in 10 minutes*`;

        await danuwa.sendMessage(from, { text: msg }, { quoted: mek });

    } catch (error) {
        console.error("Search error:", error);
        reply(`❌ *Error:* ${error.message || 'Unknown error'}`);
    }
});

// ============ HANDLE MOVIE SELECTION ============
cmd({
    filter: (text, { sender }) => {
        if (!pendingSearch[sender]) return false;
        const num = parseInt(text.trim());
        return !isNaN(num) && num > 0 && num <= pendingSearch[sender].results.length;
    }
}, async (danuwa, mek, m, { body, sender, reply, from }) => {
    await danuwa.sendMessage(from, { 
        react: { text: "✅", key: m.key } 
    });

    const index = parseInt(body.trim()) - 1;
    const selected = pendingSearch[sender].results[index];
    
    reply(`*📥 Fetching movie details...*\n${selected.title}`);

    try {
        // Get movie details
        const details = await scrapeCineSubz(selected.url || selected.movieUrl);
        
        // Build movie info message
        let caption = `*🎬 ${details.title || selected.title}*\n\n`;
        caption += `*📅 Year:* ${details.year || 'N/A'}\n`;
        caption += `*📝 Language:* ${details.language || 'N/A'}\n`;
        caption += `*⭐ IMDb:* ${details.imdb || details.rating || 'N/A'}\n`;
        
        if (details.genres && details.genres.length > 0) {
            caption += `*🎭 Genres:* ${details.genres.join(', ')}\n`;
        }
        
        if (details.cast && details.cast.length > 0) {
            caption += `*👥 Cast:* ${details.cast.slice(0, 5).join(', ')}${details.cast.length > 5 ? '...' : ''}\n`;
        }
        
        caption += `\n*📖 Description:*\n${details.description ? details.description.substring(0, 300) + '...' : 'N/A'}\n\n`;

        // Check for download links
        if (details.downloadLinks && details.downloadLinks.length > 0) {
            // Store download links
            pendingDownload[sender] = {
                movie: details,
                links: details.downloadLinks,
                timestamp: Date.now()
            };

            caption += `*📥 Download Links:*\n`;
            details.downloadLinks.forEach((link, i) => {
                caption += `*${i+1}.* ${link.quality || 'N/A'} - ${link.size || 'N/A'}\n`;
                caption += `   🔗 Server: ${link.server || 'Direct'}\n`;
            });
            caption += `\n*📌 Type a number to get the download link*`;
        } else {
            caption += `*❌ No download links available for this movie*`;
        }

        // Send with thumbnail if available
        if (details.thumbnail || details.poster) {
            const imageUrl = details.thumbnail || details.poster;
            await danuwa.sendMessage(from, {
                image: { url: imageUrl },
                caption: caption
            }, { quoted: mek });
        } else {
            await danuwa.sendMessage(from, { text: caption }, { quoted: mek });
        }

        // Clear search session
        delete pendingSearch[sender];

    } catch (error) {
        console.error("Details error:", error);
        reply(`❌ *Error fetching details:* ${error.message || 'Unknown error'}`);
    }
});

// ============ HANDLE DOWNLOAD SELECTION ============
cmd({
    filter: (text, { sender }) => {
        if (!pendingDownload[sender]) return false;
        const num = parseInt(text.trim());
        return !isNaN(num) && num > 0 && num <= pendingDownload[sender].links.length;
    }
}, async (danuwa, mek, m, { body, sender, reply, from }) => {
    await danuwa.sendMessage(from, { 
        react: { text: "⏳", key: m.key } 
    });

    const index = parseInt(body.trim()) - 1;
    const { movie, links } = pendingDownload[sender];
    const selectedLink = links[index];

    reply(`*🔗 Getting ${selectedLink.quality} download link...*\nPlease wait.`);

    try {
        // Get direct download link
        let downloadUrl = selectedLink.url || selectedLink.link;
        
        // If it's a server link, try to get direct link
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

        // Send the download link
        let message = `*🎬 ${movie.title || 'Movie'}*\n\n`;
        message += `*📊 Quality:* ${selectedLink.quality || 'N/A'}\n`;
        message += `*💾 Size:* ${selectedLink.size || 'N/A'}\n`;
        message += `*🔗 Server:* ${selectedLink.server || 'Direct'}\n\n`;
        message += `*📥 Download Link:*\n${downloadUrl}\n\n`;
        message += `*ℹ️ Note:* If the link doesn't work, try opening it in a browser.`;

        await danuwa.sendMessage(from, { text: message }, { quoted: mek });

        // Try to send as document if it's a direct video link
        if (downloadUrl && (
            downloadUrl.includes('.mp4') || 
            downloadUrl.includes('.mkv') || 
            downloadUrl.includes('pixeldrain.com/api/file') ||
            downloadUrl.includes('drive.google.com')
        )) {
            try {
                await danuwa.sendMessage(from, {
                    document: { url: downloadUrl },
                    mimetype: "video/mp4",
                    fileName: `${movie.title || 'movie'} - ${selectedLink.quality || 'HD'}.mp4`.replace(/[^\w\s.-]/gi, ''),
                    caption: `*🎬 ${movie.title || 'Movie'}*\n*📊 ${selectedLink.quality || 'HD'}*\n\n*Enjoy the movie! 🍿*`
                }, { quoted: mek });
            } catch (uploadError) {
                console.error("Upload error:", uploadError);
                // Link already sent above
            }
        }

        // Clear download session
        delete pendingDownload[sender];

    } catch (error) {
        console.error("Download error:", error);
        reply(`❌ *Error getting download link:* ${error.message || 'Unknown error'}`);
    }
});

// ============ AUTO CLEANUP SESSIONS ============
setInterval(() => {
    const now = Date.now();
    const timeout = 10 * 60 * 1000; // 10 minutes
    
    // Clean pending search
    for (const sender in pendingSearch) {
        if (now - pendingSearch[sender].timestamp > timeout) {
            delete pendingSearch[sender];
        }
    }
    
    // Clean pending download
    for (const sender in pendingDownload) {
        if (now - pendingDownload[sender].timestamp > timeout) {
            delete pendingDownload[sender];
        }
    }
}, 5 * 60 * 1000); // Check every 5 minutes

// ============ EXPORT ============
module.exports = { 
    pendingSearch, 
    pendingDownload 
};
