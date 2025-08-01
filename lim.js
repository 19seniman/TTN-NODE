require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { HttpsProxyAgent } = require('https-proxy-agent');
const randomUseragent = require('random-useragent');

const refreshToken = process.env.REFRESH_TOKEN;

const colors = {
    reset: "\x1b[0m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    white: "\x1b[37m",
    bold: "\x1b[1m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    gray: "\x1b[90m", 
};

const logger = {
    info: (msg) => console.log(`${colors.cyan}[i] ${msg}${colors.reset}`),
    warn: (msg) => console.log(`${colors.yellow}[!] ${msg}${colors.reset}`),
    error: (msg) => console.log(`${colors.red}[x] ${msg}${colors.reset}`),
    success: (msg) => console.log(`${colors.green}[+] ${msg}${colors.reset}`),
    loading: (msg) => console.log(`${colors.magenta}[*] ${msg}${colors.reset}`),
    step: (msg) => console.log(`${colors.blue}[>] ${colors.bold}${msg}${colors.reset}`),
    critical: (msg) => console.log(`${colors.red}${colors.bold}[FATAL] ${msg}${colors.reset}`),
    summary: (msg) => console.log(`${colors.green}${colors.bold}[SUMMARY] ${msg}${colors.reset}`),
    banner: () => {
        const border = `${colors.blue}${colors.bold}╔═════════════════════════════════════════╗${colors.reset}`;
        const title = `${colors.blue}${colors.bold}║   🍉 19Seniman From Insider    🍉   ║${colors.reset}`;
        const bottomBorder = `${colors.blue}${colors.bold}╚═════════════════════════════════════════╝${colors.reset}`;
        
        console.log(`\n${border}`);
        console.log(`${title}`);
        console.log(`${bottomBorder}\n`);
    },
    section: (msg) => {
        const line = '─'.repeat(40);
        console.log(`\n${colors.gray}${line}${colors.reset}`);
        if (msg) console.log(`${colors.white}${colors.bold} ${msg} ${colors.reset}`);
        console.log(`${colors.gray}${line}${colors.reset}\n`);
    },
    countdown: (msg) => process.stdout.write(`\r${colors.blue}[⏰] ${msg}${colors.reset}`),
};

/**
 * * @returns {string[]} 
 */
function readProxies() {
    const proxyFilePath = path.join(__dirname, 'proxies.txt');
    try {
        if (fs.existsSync(proxyFilePath)) {
            const proxies = fs.readFileSync(proxyFilePath, 'utf-8')
                .split('\n')
                .map(p => p.trim())
                .filter(p => p);
            return proxies;
        }
    } catch (error) {
        logger.error(`Error reading proxies.txt: ${error.message}`);
    }
    return [];
}

class TitanNode {
    constructor(refreshToken, proxy = null) {
        this.refreshToken = refreshToken;
        this.proxy = proxy;
        this.accessToken = null;
        this.userId = null;
        this.deviceId = uuidv4(); 

        const agent = this.proxy ? new HttpsProxyAgent(this.proxy) : null;

        this.api = axios.create({
            httpsAgent: agent, 
            headers: {
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Content-Type': 'application/json',
                'User-Agent': randomUseragent.getRandom(),
            }
        });

        this.ws = null;
        this.reconnectInterval = 1000 * 60 * 5; 
        this.pingInterval = null;
    }

    async refreshAccessToken() {
        logger.loading('Attempting to refresh access token...');
        try {
            const response = await this.api.post('https://task.titannet.info/api/auth/refresh-token', {
                refresh_token: this.refreshToken,
            });

            if (response.data && response.data.code === 0) {
                this.accessToken = response.data.data.access_token;
                this.userId = response.data.data.user_id;
                this.api.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`;
                logger.success('Access token refreshed successfully!');
                return true;
            } else {
                logger.error(`Failed to refresh token: ${response.data.msg || 'Unknown error'}`);
                return false;
            }
        } catch (error) {
            logger.error(`Error refreshing access token: ${error.message}`);
            return false;
        }
    }

    async registerNode() {
        logger.loading('Registering node...');
        try {
            const payload = {
                ext_version: "0.0.4",
                language: "en",
                user_script_enabled: true,
                device_id: this.deviceId,
                install_time: new Date().toISOString(),
            };
            const response = await this.api.post('https://task.titannet.info/api/webnodes/register', payload);

            if (response.data && response.data.code === 0) {
                logger.success('Node registered successfully.');
                // Changed from logger.info to logger.success for initial points, as it's a positive outcome
                logger.success(`Initial Points: ${JSON.stringify(response.data.data)}`);
            } else {
                logger.error(`Node registration failed: ${response.data.msg || 'Unknown error'}`);
            }
        } catch (error) {
            logger.error(`Error registering node: ${error.message}`);
        }
    }

    connectWebSocket() {
        logger.loading('Connecting to WebSocket...');
        const wsUrl = `wss://task.titannet.info/api/public/webnodes/ws?token=${this.accessToken}&device_id=${this.deviceId}`;
        
        const agent = this.proxy ? new HttpsProxyAgent(this.proxy) : null;

        this.ws = new WebSocket(wsUrl, {
            agent: agent,
            headers: {
                'User-Agent': this.api.defaults.headers['User-Agent'],
            }
        });

        this.ws.on('open', () => {
            logger.success('WebSocket connection established. Waiting for jobs...');
            this.pingInterval = setInterval(() => {
                if (this.ws.readyState === WebSocket.OPEN) {
                    const echoMessage = JSON.stringify({ cmd: 1, echo: "echo me", jobReport: { cfgcnt: 2, jobcnt: 0 } });
                    this.ws.send(echoMessage);
                }
            }, 30 * 1000);
        });

        this.ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                if (message.cmd === 1) {
                    const response = { cmd: 2, echo: message.echo };
                    this.ws.send(JSON.stringify(response));
                }
                if (message.userDataUpdate) {
                    // Changed from logger.point to logger.success
                    logger.success(`Points Update - Today: ${message.userDataUpdate.today_points}, Total: ${message.userDataUpdate.total_points}`);
                }
            } catch (error) {
                logger.warn(`Could not parse message: ${data}`);
            }
        });

        this.ws.on('error', (error) => {
            logger.error(`WebSocket error: ${error.message}`);
            this.ws.close();
        });

        this.ws.on('close', () => {
            logger.warn('WebSocket connection closed. Attempting to reconnect...');
            clearInterval(this.pingInterval);
            setTimeout(() => this.start(), this.reconnectInterval);
        });
    }

    async start() {
        logger.banner();
        if (this.proxy) {
            // Changed from logger.proxy to logger.info
            logger.info(`Using Proxy: ${this.proxy}`);
        } else {
            // Changed from logger.proxy to logger.info
            logger.info('Running in Direct Mode (No Proxy)');
        }
        logger.step(`Using Device ID: ${this.deviceId}`);
        
        const tokenRefreshed = await this.refreshAccessToken();
        if (tokenRefreshed) {
            await this.registerNode();
            this.connectWebSocket();
        } else {
            logger.error('Could not start bot due to token refresh failure.');
        }
    }
}

function main() {
    if (!refreshToken) {
        logger.error('Error: REFRESH_TOKEN is not set in the .env file.');
        logger.warn('Please create a .env file and add your REFRESH_TOKEN to it.');
        return;
    }

    const proxies = readProxies();

    if (proxies.length > 0) {
        logger.info(`Found ${proxies.length} proxies. Starting a bot for each one.`);
        proxies.forEach((proxy, index) => {
            
            setTimeout(() => {
                const bot = new TitanNode(refreshToken, proxy);
                bot.start();
            }, index * 10000); 
        });
    } else {
        logger.info('No proxies found in proxies.txt. Running in direct mode.');
        const bot = new TitanNode(refreshToken);
        bot.start();
    }
}

main();
