// index.js
const baiscopePlugin = require('./plugins/baiscope-downloader');

client.on('message', async (message) => {
    const content = message.body.trim();
    
    if (content.startsWith('.baiscope')) {
        const args = content.slice(9).trim().split(/\s+/);
        await baiscopePlugin.execute(message, args);
    }
});
