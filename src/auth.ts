import { sign } from "jsonwebtoken";
import { DiscordUser, DiscordResponse, DiscordGuildUser } from ".";
import { ACCESS_SECRET, CLIENT_SECRET, REFRESH_SECRET } from "../config";
import fetch from 'node-fetch';
export const createTokens = (id: string, expires_in: number, now: number, refresh_token: string) => {
	const AccessToken = sign({ user_id: id, expires_in: expires_in, now: now, refresh_token: refresh_token }, ACCESS_SECRET, { expiresIn: '15min' });

	const RefreshToken = sign({ user_id: id, expires_in: expires_in, now: now, refresh_token: refresh_token }, REFRESH_SECRET, { expiresIn: '30d' });

	return { RefreshToken, AccessToken };
}


const refresh_data = (refresh_token: string) => {
	return {
		client_id: '719720108808994917',
		client_secret: CLIENT_SECRET,
		grant_type: 'refresh_token',
		redirect_uri: 'https://discord.patrykstyla.com/api/discord-login',
		scope: 'email identify guilds',
		refresh_token: refresh_token
	}

};

export const GetDiscordToken = async (accessCode: string): Promise<DiscordResponse> => {
	console.log('Discord token aquired')
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
	return await response.json() as DiscordResponse
}
export const RefreshDiscordToken = async (refresh_token: string) => {
	console.log('Disocrd token refreshed')
	const refresh = await fetch('https://discord.com/api/oauth2/token', {
		method: 'POST',
		body: new URLSearchParams(refresh_data(refresh_token)),
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
	})

	return await refresh.json() as DiscordResponse
}

export const GetDiscordUserData = async (type: string, token: string): Promise<DiscordUser> => {
	const User = await fetch('https://discord.com/api/users/@me', {
		headers: {
			authorization: `${type} ${token}`,
		}
	})

	return await User.json() as DiscordUser
}
export const GetDiscordUserGuildData = async (type: string, token: string): Promise<DiscordGuildUser[]> => {
	const UserGuilds = await fetch('https://discord.com/api/users/@me/guilds', {
		headers: {
			authorization: `${type} ${token}`,
		}
	})

	return await UserGuilds.json() as DiscordGuildUser[]
}
