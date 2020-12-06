import http from "http";
import express from "express";
import url, { URLSearchParams } from 'url';
import fetch from 'node-fetch';
import cookieParser from "cookie-parser";
import bodyParser from 'body-parser';

import { ACCESS_SECRET, CLIENT_SECRET, REFRESH_SECRET } from "../config";
import { verify } from "jsonwebtoken";
import { createTokens, GetDiscordToken, RefreshDiscordToken as RefreshDiscordToken } from "./auth";


import { DB } from "./DB";
var app = express();
app.use(cookieParser())
app.use(express.json())

var httpServer = http.createServer(app);

const refresh = {
	// 30 days
	COOKIE_ACCESS: { maxAge: 60 * 15 * 1000 },
	// 15 min
	COOKIE_REFRESH: { maxAge: 60 * 60 * 24 * 30 * 1000 }
}
var jsonParser = bodyParser.json()

const database = new DB()

const DiscordTokenMap = new Map<string, DiscordResponse>()
const DisocrdUserMap = new Map<string, DiscordUser>()

// app.use('/', express.static("/home/tulipan/DiscordWeb/", {maxAge: 86400000 * 30}))
app.use('/favicon.ico/', express.static("/home/tulipan/DiscordWeb/dist/favicon.ico", {maxAge: 86400000 * 30}))
app.use('/dist', express.static("/home/tulipan/DiscordWeb/dist", {maxAge: 86400000 * 30}))

// Gets called on every request to express 
app.use(async (req, res, next) => {
	const accessToken = (req.cookies as WebCookies)["access_token"];
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
		// Check if Discord token is older than 6 days
		if (now > (tokenData.now + (tokenData.expires_in * 1000) - 86400000)) {
			console.log('Refresh token 6 days old')
			// Refresh Discord token
			const DiscordResponse = await RefreshDiscordToken(tokenData.refresh_token)
			tokens = createTokens(tokenData.user_id, DiscordResponse.expires_in, now, DiscordResponse.refresh_token)
		} else {
			// procceesd with current token
			tokens = createTokens(tokenData.user_id, tokenData.expires_in, tokenData.now, tokenData.refresh_token)
		}
	} else {
		console.log('Token expired')
		// Discord token has expired. Refresh it
		const DiscordResponse = await RefreshDiscordToken(tokenData.refresh_token)
		// User ID won't change
		tokens = createTokens(tokenData.user_id, DiscordResponse.expires_in, now, DiscordResponse.refresh_token)
	}

	// 30 days
	res.cookie('refresh_token', tokens.RefreshToken, refresh.COOKIE_REFRESH)
	// 15 min
	res.cookie('access_token', tokens.AccessToken, refresh.COOKIE_ACCESS)

	return next();
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
		
		const {RefreshToken, AccessToken} = createTokens(DiscordDetails.id, DiscordResponse.expires_in, Date.now(), DiscordResponse.refresh_token)

		// 30 days
		res.cookie('refresh_token', RefreshToken, refresh.COOKIE_REFRESH)
		// 15 min
		res.cookie('access_token', AccessToken, refresh.COOKIE_ACCESS)

		return res.sendFile('/home/tulipan/DiscordWeb/callback.html');
		// res.send(JSON.stringify([{ body: req.body }, { header: req.headers }]))
	} else {
		return res.send(JSON.stringify({ error: "no token provided" }))
	}

})

// app.get('*', function (req, res) {
// 	
// 	res.redirect("/")
// })

app.get('/',  (req, res) => {
	console.log('/')
	res.sendFile('/home/tulipan/DiscordWeb/index.html');
})
app.get('/login', async (req, res) => {
	console.log('/login')	
})


app.get('/api/users/@me', async (req, res) => {
	if (!(req as any).user_id) {
		return res.json(null);
	}

	// Check Disocrd Token
	// TODO: Cache
	const User = await database.GetUserDetails((req as any).user_id)

	if (User[1]) {
		const a = User[1]
		// refresh auth token
		const DiscordResponse = await RefreshDiscordToken(User[1] as any)
		database.AddDiscordAuth((req as any).user_id, DiscordResponse);

		const {RefreshToken, AccessToken} = createTokens((req as any).user_id, DiscordResponse.expires_in, Date.now(), DiscordResponse.refresh_token)

		// 30 days
		res.cookie('refresh_token', RefreshToken, refresh.COOKIE_REFRESH)
		// 15 min
		res.cookie('access_token', AccessToken, refresh.COOKIE_ACCESS)
	}

	res.json(User[0])	 
})

app.post('/api/guilds/@channels', jsonParser, async (req, res) => {
	if (!(req as any).user_id) {
		return res.json({Nope: "nope"});
	}
	const guild_id = req.body.channel_id as string

	const Channels = await database.GetGuildChannels(guild_id)

	res.json(Channels);
})

app.get('/api/channels/:channel_id/messages', async (req, res) => {
	const Messages = await database.GetChannelMessages(req.params.channel_id)

	res.json(Messages)
})

// ALWAYS LAST
app.get('*', async function (req, res) {
	// if (!(req as any).token) {
	// 	return res.redirect("/login")
	// }
	//
	res.sendFile('/home/tulipan/DiscordWeb/index.html');
	console.log('Wildcard')
})

httpServer.listen(3000, 'localhost', () => {
	console.log("hey")
});

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