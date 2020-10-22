import { sign } from "jsonwebtoken";
import { DiscordUser, DiscordResponse } from ".";
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
export const RefreshDisocrdToken = async (refresh_token: string) => {
    const refresh = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams(refresh_data(refresh_token)),
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
    })
    return await refresh.json() as DiscordResponse
}