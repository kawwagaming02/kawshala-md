const { cmd } = require("../command");
const { searchCineSubz, scrapeCineSubz, scrapeCineSubzServerLink } = require('cinesubz-scraper');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

// ============ SESSION STORAGE ============
const pendingSearch = {};

// ============ GET REAL DOWNLOAD URL ============
async function getRealDownloadUrl(url) {
    try {
        console.log(`🔍 Getting real URL from: ${url}`);

        // Method 1: Try with scrapeCineSubzServerLink
        try {
            const directLink = await scrapeCineSubzServerLink(url);
            if (directLink && directLink.startsWith('http') && !directLink.includes('undefined')) {
                // Check if it's a video file
                if (directLink.match(/\.(mp4|mkv|avi|mov)$/i) || directLink.includes('pixeldrain.com/api/file')) {
                    console.log(`✅ Found video link: ${directLink}`);
                    return directLink;
                }
            }
        } catch (e) {
            console.log('⚠️ scrapeCineSubzServerLink failed');
        }

        // Method 2: Follow redirects and check content-type
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                maxRedirects: 5,
                timeout: 30000,
                validateStatus: () => true
            });

            // Check if it's a video file
            const contentType = response.headers['content-type'] || '';
            const contentLength = response.headers['content-length'] || 0;

            console.log(`📊 Content-Type: ${contentType}`);
            console.log(`📊 Content-Length: ${contentLength}`);

            // If it's a video file
            if (contentType.includes('video') || contentType.includes('octet-stream')) {
                if (contentLength > 1000000) { // > 1MB
                    console.log(`✅ Found video with content-type: ${contentType}`);
                    return url;
                }
            }

            // Check if it's a redirect
            if (response.status === 302 || response.status === 301) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    console.log(`🔄 Redirecting to: ${redirectUrl}`);
                    return await getRealDownloadUrl(redirectUrl);
                }
            }

        } catch (e) {
            console.log('⚠️ Axios check failed:', e.message);
        }

        // Method 3: Try with puppeteer
        try {
            const puppeteer = require('puppeteer');
            const browser = await puppeteer.launch({ 
                headless: true, 
                args: ['--no-sandbox', '--disable-setuid-sandbox'] 
            });
            const page = await browser.newPage();
            
            // Set user agent
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            
            // Go to page
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

            // Check for video sources
            const videoUrl = await page.evaluate(() => {
                // Check video elements
                const video = document.querySelector('video');
                if (video && video.src) return video.src;

                // Check video sources
                const sources = document.querySelectorAll('video source');
                for (const source of sources) {
                    if (source.src) return source.src;
                }

                // Check download links
                const links = document.querySelectorAll('a[href*="download"], a[href*=".mp4"], a[href*=".mkv"]');
                for (const link of links) {
                    if (link.href && link.href.startsWith('http')) {
                        return link.href;
                    }
                }

                return null;
            });

            await browser.close();

            if (videoUrl) {
                console.log(`✅ Found video via puppeteer: ${videoUrl}`);
                return videoUrl;
            }

        } catch (e) {
            console.log('⚠️ Puppeteer failed:', e.message);
        }

        // Method 4: Check if URL already ends with video extension
        if (url.match(/\.(mp4|mkv|avi|mov|wmv|flv)$/i)) {
            console.log(`✅ URL is already a video file: ${url}`);
            return url;
        }

        console.log('❌ Could not find real download URL');
        return null;

    } catch (error) {
        console.error('❌ Error getting real URL:', error);
        return null;
    }
}

// ============ DOWNLOAD AND SEND FILE ============
async function downloadAndSendMovie(client, from, downloadUrl, fileName, caption, m) {
    try {
        // Get real download URL
        const realUrl = await getRealDownloadUrl(downloadUrl);
        
        if (!realUrl) {
            return { 
                success: false, 
                message: "Could not find valid download URL" 
            };
        }

        console.log(`✅ Real URL: ${realUrl}`);

        // Create temp directory
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const filePath = path.join(tempDir, fileName);
        
        // Send progress message
        await client.sendMessage(from, {
            text: `📥 *Downloading Movie*\n━━━━━━━━━━━━━━━━\n🎬 ${fileName.replace('.mp4', '')}\n⏳ Please wait... This may take a few minutes.`
        }, { quoted: m });

        // Download with progress
        const response = await axios({
            method: 'GET',
            url: realUrl,
            responseType: 'stream',
            timeout: 600000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'video/mp4,video/*,*/*',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive'
            },
            maxRedirects: 5
        });

        // Check content type
        const contentType = response.headers['content-type'] || '';
        const contentLength = response.headers['content-length'] || 0;

        console.log(`📊 Content-Type: ${contentType}`);
        console.log(`📊 Content-Length: ${contentLength}`);

        // Check if it's a video file
        if (!contentType.includes('video') && !contentType.includes('octet-stream')) {
            return {
                success: false,
                message: `Invalid content type: ${contentType}. This is not a video file.`
            };
        }

        // Check file size
        if (contentLength > 0 && contentLength < 1000000) {
            return {
                success: false,
                message: `File too small (${(contentLength/1024).toFixed(1)} KB). This is not a valid video file.`
            };
        }

        // Download
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', async () => {
                try {
                    const stats = fs.statSync(filePath);
                    const fileSizeMB = stats.size / (1024 * 1024);
                    
                    console.log(`✅ Download complete: ${fileSizeMB.toFixed(2)} MB`);

                    if (fileSizeMB < 1) {
                        fs.unlinkSync(filePath);
                        resolve({ 
                            success: false, 
                            message: `File too small (${fileSizeMB.toFixed(2)} MB). Not a valid video.` 
                        });
                        return;
                    }

                    if (fileSizeMB > 2000) {
                        fs.unlinkSync(filePath);
                        resolve({ 
                            success: false, 
                            message: `File too large (${fileSizeMB.toFixed(2)} MB). WhatsApp limit is 2GB.` 
                        });
                        return;
                    }

                    await client.sendMessage(from, {
                        document: {
                            url: filePath
                        },
                        mimetype: "video/mp4",
                        fileName: fileName,
                        caption: caption
                    }, { quoted: m });

                    fs.unlinkSync(filePath);
                    
                    resolve({ 
                        success: true, 
                        message: "Movie sent successfully!",
                        size: fileSizeMB.toFixed(2)
                    });

                } catch (error) {
                    try { fs.unlinkSync(filePath); } catch (e) {}
                    reject(error);
                }
            });

            writer.on('error', (error) => {
                try { fs.unlinkSync(filePath); } catch (e) {}
                reject(error);
            });
        });

    } catch (error) {
        console.error("Download error:", error);
        return { 
            success: false, 
            message: error.message || "Download failed" 
        };
    }
}

// ============ DOWNLOAD MOVIE FUNCTION ============
async function downloadMovie(client, from, movie, quality, m, reply) {
    try {
        // Get movie details
        const details = await scrapeCineSubz(movie.url || movie.movieUrl);
        
        if (!details.downloadLinks || details.downloadLinks.length === 0) {
            return reply(`❌ *No download links found for this movie*`);
        }

        // Find quality
        let selectedLink = null;
        for (const link of details.downloadLinks) {
            if (link.quality && link.quality.toLowerCase().includes(quality.toLowerCase())) {
                selectedLink = link;
                break;
            }
        }

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

        if (!selectedLink) {
            selectedLink = details.downloadLinks[0];
        }

        // Get download URL
        let downloadUrl = selectedLink.url || selectedLink.link || selectedLink.href;
        
        console.log(`📥 Selected link: ${downloadUrl}`);

        if (!downloadUrl || downloadUrl === 'undefined' || downloadUrl === 'null') {
            return reply(`❌ *Could not get download URL*\n\nTry another quality or movie.`);
        }

        // Prepare file name
        const cleanTitle = details.title || movie.title || 'Movie';
        const cleanQuality = selectedLink.quality || quality;
        const fileName = `${cleanTitle} - ${cleanQuality}.mp4`.replace(/[^\w\s.-]/gi, '');

        // Download and send
        const result = await downloadAndSendMovie(
            client,
            from,
            downloadUrl,
            fileName,
            `🎬 *${cleanTitle}*\n📊 ${cleanQuality}\n💾 ${selectedLink.size || 'N/A'}\n\n*Powered by Zanta Bot*`,
            m
        );

        if (!result.success) {
            reply(`❌ *Download Failed*\n━━━━━━━━━━━━━━━━\n${result.message}`);
        }

    } catch (error) {
        console.error("Download error:", error);
        reply(`❌ *Error:* ${error.message || 'Unknown error'}`);
    }
}

// ============ MAIN COMMAND ============
cmd({
    pattern: "cs",
    alias: ["cinesubz", "movie", "film"],
    react: "🎬",
    desc: "CineSubz එකෙන් චිත්‍රපට File එක බාගන්න",
    category: "download",
    filename: __filename
}, async (client, message, m, { from, q, sender, reply }) => {
    if (!q) {
        return reply(`🎬 *CineSubz Movie Downloader*

*භාවිතය:*
• cs චිත්‍රපට_නම
• movie චිත්‍රපට_නම

*උදාහරණ:*
• cs harry potter
• movie avatar
• cs captain america 720p`);
    }

    await client.sendMessage(from, { 
        react: { text: "⏳", key: m.key } 
    });

    const parts = q.trim().split(/\s+/);
    let movieName = q;
    let quality = '720p';

    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.match(/^\d{3,4}p$/)) {
        movieName = parts.slice(0, -1).join(' ');
        quality = lastPart;
    }

    reply(`🔍 *Searching for "${movieName}"...*`);

    try {
        const results = await searchCineSubz(movieName);
        
        if (!results || results.length === 0) {
            return reply(`❌ *No movies found for "${movieName}"*`);
        }

        if (results.length > 1) {
            pendingSearch[sender] = { 
                results: results, 
                quality: quality,
                timestamp: Date.now() 
            };

            let msg = `🎬 *Search Results*\n━━━━━━━━━━━━━━━━\n\n`;
            const displayCount = Math.min(8, results.length);
            
            for (let i = 0; i < displayCount; i++) {
                const movie = results[i];
                msg += `*${i+1}.* ${movie.title || 'N/A'}\n`;
                msg += `   📊 ${movie.quality || 'N/A'}\n`;
                msg += `   📝 ${movie.language || 'N/A'}\n\n`;
            }
            
            msg += `━━━━━━━━━━━━━━━━\n`;
            msg += `📌 *Reply with number (1-${displayCount})*\n`;
            msg += `⏱️ *Expires in 5 minutes*`;

            await client.sendMessage(from, { text: msg }, { quoted: m });
            return;
        }

        const movie = results[0];
        await downloadMovie(client, from, movie, quality, m, reply);

    } catch (error) {
        console.error("Download error:", error);
        reply(`❌ *Error:* ${error.message || 'Unknown error'}`);
    }
});

// ============ HANDLE SEARCH SELECTION ============
cmd({
    filter: (text, { sender }) => {
        if (!pendingSearch[sender]) return false;
        const num = parseInt(text.trim());
        return !isNaN(num) && num > 0 && num <= pendingSearch[sender].results.length;
    }
}, async (client, message, m, { body, sender, reply, from }) => {
    await client.sendMessage(from, { 
        react: { text: "✅", key: m.key } 
    });

    const index = parseInt(body.trim()) - 1;
    const { results, quality } = pendingSearch[sender];
    const selected = results[index];

    await downloadMovie(client, from, selected, quality, m, reply);
    
    delete pendingSearch[sender];
});

// ============ AUTO CLEANUP ============
setInterval(() => {
    const now = Date.now();
    const timeout = 5 * 60 * 1000;
    
    for (const sender in pendingSearch) {
        if (now - pendingSearch[sender].timestamp > timeout) {
            delete pendingSearch[sender];
        }
    }

    try {
        const tempDir = path.join(__dirname, 'temp');
        if (fs.existsSync(tempDir)) {
            const files = fs.readdirSync(tempDir);
            for (const file of files) {
                const filePath = path.join(tempDir, file);
                const stats = fs.statSync(filePath);
                const age = (now - stats.mtimeMs) / (1000 * 60);
                if (age > 30) {
                    fs.unlinkSync(filePath);
                    console.log(`🧹 Deleted old temp file: ${file}`);
                }
            }
        }
    } catch (e) {}
}, 5 * 60 * 1000);

module.exports = { pendingSearch };
