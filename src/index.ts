import http from "http";
import express from "express";
import url, { URLSearchParams } from 'url';
import fetch from 'node-fetch';
import cookieParser from "cookie-parser";
const proxy = require('proxy-middleware');


import { ACCESS_SECRET, CLIENT_SECRET, REFRESH_SECRET } from "../config";
import { verify } from "jsonwebtoken";
import { createTokens, RefreshDisocrdToken as RefreshDiscordToken } from "./auth";
import { webpack } from "webpack";

var webpackDevMiddleware = require("webpack-dev-middleware");
var webpackHotMiddleware = require("webpack-hot-middleware");
const webpackConfig = require('/home/tulipan/DiscordWeb/webpack.config.js');
const compiler = webpack(webpackConfig);

import { DB } from "./DB";
var app = express();
app.use(cookieParser())




var httpServer = http.createServer(app);
const refresh = {
	// 30 days
	COOKIE_ACCESS: { maxAge: 60 * 15 * 1000 },
	// 15 min
	COOKIE_REFRESH: { maxAge: 60 * 60 * 24 * 30 * 1000 }
}

const database = new DB()

app.use('/', express.static("/home/tulipan/DiscordWeb/dist", {maxAge: 86400000 * 30}))
app.use(
	webpackDevMiddleware(compiler, {
		hot: true,
		filename: "bundle.js",
		publicPath: "/assets/",
		stats: {
		  colors: true
		},
		historyApiFallback: true
	})
)

app.use(
	webpackHotMiddleware(compiler, {
	  log: console.log,
	  path: "/__webpack_hmr",
	  heartbeat: 10 * 1000
	})
  );

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
		const UserToken = await database.GetUserDetails(tokenData.user_id);
		(req as any).token = UserToken[0].access_token
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
	}
	
	// handle the Discord token
	if (now < tokenData.now + (tokenData.expires_in * 1000)) {
		// Disocrd token is still valid
		// Check if Discord token is older than 6 days
		if (now > (tokenData.now + (tokenData.expires_in * 1000) - 86400)) {
			// Refresh Discord token
			const DiscordResponse = await RefreshDiscordToken(tokenData.refresh_token)
			tokens = createTokens(tokenData.user_id, DiscordResponse.expires_in, now, DiscordResponse.refresh_token)
		} else {
			// procceesd with current token
			tokens = createTokens(tokenData.user_id, tokenData.expires_in, tokenData.now, tokenData.refresh_token)
		}
	} else {
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

// app.get('/static/bundle.js', async function (req, res) {
// 	return res.sendFile('/home/tulipan/DiscordWeb/dist/bundle.js');
// })

app.get('/api/discord-login', async function (req, res) {
	const urlObj = url.parse(req.url, true);

	if (urlObj.query.code) {
		const accessCode = urlObj.query.code;
		console.log(`The access code is: ${accessCode}`);
		// Data for discord auth
		const data = {
			client_id: '719720108808994917',
			client_secret: CLIENT_SECRET,
			grant_type: 'authorization_code',
			redirect_uri: 'https://discord.patrykstyla.com/api/discord-login',
			code: accessCode,
		};
		// fetch token
		const response = await fetch('https://discord.com/api/oauth2/token', {
			method: 'POST',
			body: new URLSearchParams(data),
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
		})
		const DiscordResponse = await response.json() as DiscordResponse

		// get user details
		const User = await fetch('https://discord.com/api/users/@me', {
			headers: {
				authorization: `${DiscordResponse.token_type} ${DiscordResponse.access_token}`,
			}
		})

		// get user details
		const UserGuilds = await fetch('https://discord.com/api/users/@me/guilds', {
			headers: {
				authorization: `${DiscordResponse.token_type} ${DiscordResponse.access_token}`,
			}
		})
		

		const DiscordDetails = await User.json() as DiscordUser
		const DisocrdUserGuildDetails = await UserGuilds.json() as DiscordGuildUser

		await database.AddDiscordAuth(DiscordDetails.id, DiscordResponse);

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
// 	console.log("not found")
// 	res.redirect("/")
// })

app.get('/', async function (req, res) {
	console.log('/')
	res.sendFile('/home/tulipan/DiscordWeb/index.html');
})
app.get('/login', async function (req, res) {
	console.log('/login')
	res.json("please login")
})

app.get('*', async function (req, res) {
	if (!(req as any).token) {
		return res.redirect("/login")
	}
	console.log('Wildcard')
	res.sendFile('/home/tulipan/DiscordWeb/index.html');
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