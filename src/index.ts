import http from "http";
import express from "express";
import url, { URLSearchParams } from 'url';
import { URL } from 'url'
import fetch from 'node-fetch';
import cookieParser from "cookie-parser";
import bodyParser from 'body-parser';
import nacl from "tweetnacl";
import { ACCESS_SECRET, CLIENT_SECRET, REFRESH_SECRET } from "../config";
import { verify } from "jsonwebtoken";
import { createAccessToken, createTokens, GetDiscordToken, RefreshDiscordToken } from "./auth";
import fs from "fs";
import FfmpegCommand from 'fluent-ffmpeg'
import ydtl from "ytdl-core";
import { WebSocket, SendMessageToWebSocket } from "/home/ubuntu/DiscordWebServer/WebSocketClient";

const BossMusicFilePath = "/home/ubuntu/DiscordBotJS/audioClips/"


import { DB } from "./DB";
var app = express();
app.use(cookieParser())
app.use(bodyParser.json({
	verify: (req, res, buf) => {
	  (req as any).rawBody = buf
	}
  }))

var httpServer = http.createServer(app);

const refresh = {
	// time must be in miliseconds
	// 15 min
	COOKIE_ACCESS: { maxAge: 60 * 15 * 1000 },
	// 30 days
	COOKIE_REFRESH: { maxAge: 60 * 60 * 24 * 30 * 1000 }
}
var jsonParser = bodyParser.json()

const database = new DB()

const DiscordTokenMap = new Map<string, DiscordResponse>()
const DisocrdUserMap = new Map<string, DiscordUser>()

// app.use('/', express.static("/home/ubuntu/DiscordWeb/", {maxAge: 86400000 * 30}))
// app.use('/favicon.ico/', express.static("/home/ubuntu/DiscordWeb/dist/favicon.ico", { maxAge: 86400000 * 30 }))
// app.use('/dist', express.static("/home/ubuntu/DiscordWeb/dist", { maxAge: 86400000 * 30 }))
// Gets called on every request to express 
app.use(async (req, res, next) => {
	console.log(req.path)
	if(req.url === "/api/interactions") {
		// Don't verify anything if is interaction
		next()
	}
	let accessToken = (req.cookies as WebCookies)["access_token"];
	const refreshToken = (req.cookies as WebCookies)["refresh_token"];
	let tokenData
	let tokens: {
		RefreshToken: string;
		AccessToken: string;
	} | null = null
	const now = Date.now()
	if (!refreshToken && !accessToken) {
		return next()
	}
	try {
		// check if access token is valid
		tokenData = verify(accessToken, ACCESS_SECRET) as JWTTokens;
		(req as any).user_id = tokenData.user_id;
		return next()
	} catch (error) {
		if (refreshToken) {
			try {
				// check if refresh token is valid
				tokenData = verify(refreshToken, REFRESH_SECRET) as JWTTokens
				accessToken = createAccessToken(tokenData.user_id, tokenData.expires_in, now, tokenData.refresh_token);
				(req as any).user_id = tokenData.user_id;
			} catch (error) {
				return next();
			}
		} else {
			// No refresh or access
			return next()
		}
	}

	if (!refreshToken) {
		return next()
	}

	try {
		// check if refresh token is valid
		tokenData = verify(refreshToken, REFRESH_SECRET) as JWTTokens
	} catch (error) {
		return next();
	};

	// handle the Discord token
	if (now < tokenData.now + (tokenData.expires_in * 1000)) {
		// Disocrd token is still valid
		// Check if Discord token is older than 6 days			1 day in miliseconds
		if (now > (tokenData.now + (tokenData.expires_in * 1000) - 86400000)) {
			console.log('Refresh token 6 days old')
			// Refresh Discord token
			const DiscordResponse = await RefreshDiscordToken(tokenData.refresh_token)
			tokens = createTokens(tokenData.user_id, DiscordResponse.expires_in, now, DiscordResponse.refresh_token)
			database.UpdateDiscordAuth(DiscordResponse)
		} else {
			// procceesd with current token
			tokens ={ AccessToken: accessToken, RefreshToken: refreshToken}
		}
	} else {
		console.log('Token expired')
		// Discord token has expired. Refresh it
		const DiscordResponse = await RefreshDiscordToken(tokenData.refresh_token)
		// User ID won't change
		tokens = createTokens(tokenData.user_id, DiscordResponse.expires_in, now, DiscordResponse.refresh_token)
		database.UpdateDiscordAuth(DiscordResponse)
	}

	// 30 days
	res.cookie('refresh_token', tokens.RefreshToken, { maxAge: refresh.COOKIE_REFRESH.maxAge, path: '/' })
	// 15 min
	res.cookie('access_token', tokens.AccessToken, { maxAge: refresh.COOKIE_ACCESS.maxAge, path: '/' })

	next();
})

app.get('/api/discord-login', async function (req, res) {
	const urlObj = url.parse(req.url, true);
	if (urlObj.query.code) {
		const accessCode = urlObj.query.code;
		// Data for discord auth
		const DiscordResponse = await GetDiscordToken(accessCode as string)

		// get user details
		const User = await fetch('https://discord.com/api/users/@me', {
			headers: {
				authorization: `${DiscordResponse.token_type} ${DiscordResponse.access_token}`,
			}
		})

		// get user guild details
		const UserGuilds = await fetch('https://discord.com/api/users/@me/guilds', {
			headers: {
				authorization: `${DiscordResponse.token_type} ${DiscordResponse.access_token}`,
			}
		})


		const DiscordDetails = await User.json() as DiscordUser
		const DiscordUserGuildDetails = await UserGuilds.json() as DiscordGuildUser[]
		// console.log(DiscordResponse)
		console.log(DiscordDetails)
		// console.log(DiscordUserGuildDetails)

		await database.AddDiscordAuthAndData(DiscordDetails, DiscordResponse, DiscordUserGuildDetails);

		const { RefreshToken, AccessToken } = createTokens(DiscordDetails.id, DiscordResponse.expires_in, Date.now(), DiscordResponse.refresh_token)

	// 	// 30 days
		res.cookie('refresh_token', RefreshToken, { maxAge: refresh.COOKIE_REFRESH.maxAge})
		// 15 min
		res.cookie('access_token', AccessToken, { maxAge: refresh.COOKIE_ACCESS.maxAge})

		return res.sendFile('/home/ubuntu/DiscordWeb/callback.html');
		// res.send(JSON.stringify([{ body: req.body }, { header: req.headers }]))
	} else {
		return res.send(JSON.stringify({ error: "no token provided" }))
	}

})

// app.get('*', function (req, res) {
// 	
// 	res.redirect("/")
// })

// app.get('/', (req, res) => {
// 	console.log('/')
// 	res.sendFile('/home/ubuntu/DiscordWeb/index.html');
// })

app.get('/api/:guild_id/users', async (req, res) => {
	if (!(req as any).user_id) {
		return res.json(null);
	}

	const GuildUsers = await database.getGuildUsers(req.params.guild_id!)

	res.json(GuildUsers);
})

app.get('/api/users/@me', async (req, res) => {
	if (!(req as any).user_id) {
		return res.json(null);
	}
	// Check Disocrd Token
	// TODO: Cache
	const User = await database.GetUserDetails((req as any).user_id)

	// console.log(User)

	// if (User[1]) {
	// 	const a = User[1]
	// 	// refresh auth token
	// 	const DiscordResponse = await RefreshDiscordToken(User[1] as any)
	// 	database.AddDiscordAuth((req as any).user_id, DiscordResponse);

	// 	const { RefreshToken, AccessToken } = createTokens((req as any).user_id, DiscordResponse.expires_in, Date.now(), DiscordResponse.refresh_token)

	// 	// 30 days
	// 	res.cookie('refresh_token', RefreshToken, { maxAge: refresh.COOKIE_REFRESH.maxAge, path: '/' })
	// 	// 15 min
	// 	res.cookie('access_token', AccessToken, { maxAge: refresh.COOKIE_ACCESS.maxAge, path: '/' })
	// }

	res.json(User)
})

app.post('/api/guilds/@channels', jsonParser, async (req, res) => {
	if (!(req as any).user_id) {
		return res.json({ Nope: "nope" });
	}
	const guild_id = req.body.channel_id as string

	const Channels = await database.GetGuildChannels(guild_id)

	res.json(Channels);
})

app.get('/api/channels/:channel_id/messages', async (req, res) => {
	const Messages = await database.GetChannelMessages(req.params.channel_id)

	res.json(Messages)
})

app.get('/interactions', async function (req, res) {
	console.log('GET interactions')

	return;
})

app.post('/api/interactions', async function (req, res) {
	console.log('POST interactions')
	const PUBLIC_KEY = '04458190ee3ca7879627465b97ae4527d627a31f83de1635881bf71aa1a63a0e';

	const signature = req.get('X-Signature-Ed25519')!;
	const timestamp = req.get('X-Signature-Timestamp')!;
	const body = (req as any).rawBody as Buffer// rawBody is expected to be a string, not raw bytes
	const isVerified = nacl.sign.detached.verify(
		Buffer.from(timestamp + body),
		Buffer.from(signature, 'hex'),
		Buffer.from(PUBLIC_KEY, 'hex')
	);

	if (!isVerified) {
		// Send 401 on FAIL
		// MUST BE PRESENT. DISCORD WILL SEND INVALID SIGNATUES
		return res.status(401).end('invalid request signature');
	} else {
		// Send a "pong" on success
		if (req.body.type === 1) {
			// PING -> PONG
			res.end(JSON.stringify({type: 1}))
		} else {
			// TODO: Handle all types
			if (req.body.data.name === "add") {
				const interactionAdd = req.body as Interaction<InteractionOptionsAdd>

				AddMusicViaYTLink([
					interactionAdd.data.options[0].value,
					interactionAdd.data.options[1].value,
					interactionAdd.data.options[2].value
				] , interactionAdd.member.user.id
				, res);

				return res.json({
					"type": 4,
					"data": {
						"tts": false,
						"content": "Ok Piss"
					}
				})

			} else {
				// Unkown (or misspelled) interaction
				return res.json({
					"type": 4,
					"data": {
						"tts": false,
						"content": "https://discord.patrykstyla.com"
					}
				})
			}

		}
	}
})

// ALWAYS LAST
app.get('*', async function (req, res) {
	// if (!(req as any).token) {
	// 	return res.redirect("/login")
	// }
	//
	res.sendFile('/home/ubuntu/DiscordWeb/index.html');
	console.log('Wildcard')
})

httpServer.listen(3000, 'localhost', () => {
	console.log("hey")
});

interface Interaction<T> {
	application_id: string,
	channel_id: string,
	data: InteractionData<T>,
	guild_id: string,
	id: string,
	member: member,
	token: string,
	type: number,
	version: number
}

interface member {
	deaf: boolean,
	is_pending: boolean,
	joined: string,
	mute: boolean,
	nick: string | null,
	permissions: string,
	premium_since: string | null,
	roles: string[],
	user: user,
}

interface user {
	avatar: string,
	discriminator: string,
	id: string,
	public_flags: string,
	username: string
}

interface InteractionData<T> {
	id: string,
	name: string,
	options: T[]
}

interface InteractionOptionsAdd{
	name: string,
	type: string,
	value: string
}

export interface DiscordResponse {
	access_token: string,
	expires_in: number,
	refresh_token: string,
	// scope: 'identify' | 'email' | 'connections' | 'guilds' | 'guilds.join' | 'gdm.join' | 'rpc' | 'rpc.notifications.read' | 'messages.read',
	scope: string // Can be of above type TODO: there are more types. prob won't be needed
	token_type: 'Bearer'
}

interface WebCookies {
	refresh_token: string,
	access_token: string,
}

export interface DiscordUser {
	id: string,
	username: string,
	avatar: string,
	discriminator: number,
	public_flags: number,
	flags: number,
	email: string,
	verified: boolean,
	locale: string,
	mfa_enabled: boolean
}

export interface DiscordGuildUser {
	id: string,
	name: string,
	icon: string,
	owner: boolean,
	permissions: number,
}

export interface JWTTokens {
	user_id: string,
	expires_in: number,
	iat: number,
	now: number
	exp: number,
	refresh_token: string

}

function AddMusicViaYTLink(args: string[], user_id: string, res: any) {
	let command = args.shift();

	if (!command) {
		// msg.reply("No url");
		return res.status(401).json({
			"type": 4,
			"data": {
				"tts": false,
				"content": "no url"
			}
		})
	}
	// [0] for the full url
	const matches = command.match(/^(https?\:\/\/)?((www\.)?youtube\.com|youtu\.?be)\/.+$/);

	if (!matches) {
		return res.status(401).json({
			"type": 4,
			"data": {
				"tts": false,
				"content": "Not a youtube url"
			}
		})
	}
	let start = convert(args[0]);
	let finish = convert(args[1]);

	if (finish - start > 20) {
		// No timestamps provided
		return res.status(401).json({
			"type": 4,
			"data": {
				"tts": false,
				"content": "Max 20 seconds"
			}
		})
	}

	// Unique? id for temp audio file
	const date = Date.now() * Math.floor(Math.random() * 100000);
	ydtl(matches[0], { filter: 'audioonly', quality: 'highestaudio' }).pipe(fs.createWriteStream(BossMusicFilePath + date)).on('finish', () => {
		// Process file with ffmpeg
		ConvertFFmpeg(BossMusicFilePath + date, user_id, date.toString(), start, finish);
	});
}

function convert(input: string) {
	// if length 0 index [0] is < 60 secs
	// if length 1 index [0] is < 60 min and index [1] is < 60 secs
	// if length 3 index [0] is < 60 hours, index [1] is < 60 min and index [2] is < 60 secs
	var a = input.split(':'); // split it at the colons
	let seconds = 0; 

	if (a.length === 1) {
		let b = parseInt(a[0])
		seconds = b;
	} else if (a.length === 2) {
		let b = parseInt(a[0])
		let bb = parseInt(a[1])
		seconds = (b * 60) + bb
	} else {
		let b = parseInt(a[0])
		let bb = parseInt(a[1])
		let bbb = parseInt(a[2])
		seconds = ((b * 60 * 60) + (bb * 60)) + bbb
	}

	return seconds
}

function ConvertFFmpeg(dest: string, user_id: string, fileName: string, start: number = 0, end: number = 0) {
	let command = FfmpegCommand(dest);
	command.on('start', (a) => {
		console.log(a);
	})
	.inputOptions([`-ss ${start}`, `-to ${end}`])
	// the other functions set the output options and it wont work otherwise
	.outputOptions(['-c:a libopus', '-b:a 96k'])
	.on('start', function (commandLine) {
		console.log('Spawned Ffmpeg with command: ' + commandLine);
	})
	.on('end', function () {
		// Done with the temporary file remove.
		fs.unlink(dest, (err) => {
			if (err) {
				console.error(err);
				return;
			}
		});
		// TODO: Remove/Store/Limit/Update previous boss musics
		database.UpdateUserBossMusic(user_id, fileName);
	})
	.on('error', function (err) {
		console.log('an error happened: ' + err);
	})
	.saveToFile(dest + '.ogg');
}