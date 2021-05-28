 import { Pool, createPool, createConnection, Connection, MysqlError } from "mysql";
import { DiscordGuildUser, DiscordResponse, DiscordUser } from ".";
import { username, password, host } from "../config";

// process.on('unhandledRejection', (reason) => {
// 	console.log(reason)
// 	const db = new DB;
// 	db.LogDatabaseError(reason as any)
// })
export class DB {
	public pool: Pool;
	constructor() {
		this.pool = createPool({
			connectionLimit: 100,
			host,
			user: username,
			password,
			database: "DiscordBot",
			multipleStatements: true,
			charset: "utf8mb4_general_ci",
			debug: false,
		});
	}

	private async GetQuery<T>(query: string): Promise<T[]> {
		return new Promise<T[]>((resolve, reject) => {
			this.pool.query(query, (error, results) => {
				if (error) {
					reject(error);
				} 
				resolve(results);
			});
		}).then((value) => {
			return value
		}).catch((error: MysqlError): any => {
			this.LogDatabaseError(error)
		})
	}

	public async LogDatabaseError(error: MysqlError) {
		await this.GetQuery(`INSERT INTO errors (error_object) VALUES (${this.pool.escape(JSON.stringify(error))})`)
	}
	public async GetUserDetails(user_id: string){
		let sql = `SELECT * FROM WEB__users WHERE user_id = '${user_id}'`

		let result = await this.GetQuery<WebsiteUser>(sql);

		if (!result) {
			// No result in DB Get some
			return null;
		}

		// TODO QUERY DISCORD API AT LEAST FOR GUILDS
		// Get all the guild the user AND the bot is in
		sql = `SELECT guild_id, name, permissions, icon FROM guilds LEFT JOIN user_to_guild ON guild_id = id WHERE bot_active = '1' AND user_id = '${result[0].user_id}'`
		const User = await this.GetQuery<{guild_id: string, permissions: number, name: string, icon: string}>(sql);

		return User;	
	}

	public async HandleDiscordToken() {

	}

	public async AddDiscordAuthAndData(User: DiscordUser, DiscordDetails: DiscordResponse, DiscordUserGuildDetails: DiscordGuildUser[]) {
		// Add user - Can be a duplicate
		// Add the discord auth user - can be duplicate
		// Add all of the users guilds
		// Add the guilds the user is in
		let AddUserGuilds = "INSERT IGNORE INTO guilds (id, name, owner_id, bot_active) VALUES "
		let AddUserToGuild = "INSERT IGNORE INTO user_to_guild (user_id, guild_id, permissions) VALUES "

		DiscordUserGuildDetails.forEach((element) => {
			AddUserGuilds += `('${element.id}', ${this.pool.escape(element.name)}, 0, '0'),`
			AddUserToGuild += `('${User.id}', '${element.id}', '${element.permissions}'),`
		})

		AddUserGuilds = `${AddUserGuilds.slice(0, -1)};`;
		AddUserToGuild = `${AddUserToGuild.slice(0, -1)};`;

		let sql = `INSERT IGNORE INTO users (id, username, discriminator, bot) VALUES ('${User.id}', ${this.pool.escape(User.username)}, '${User.discriminator}', '0');\
INSERT IGNORE INTO WEB__users (user_id, access_token, refresh_token, scope, expires_in, token_type, email) VALUES ('${User.id}', '${DiscordDetails.access_token}', '${DiscordDetails.refresh_token}', '${DiscordDetails.scope}', '${DiscordDetails.expires_in}', '${DiscordDetails.token_type}', '${User.email}') ON DUPLICATE KEY UPDATE access_token = VALUES(access_token), refresh_token = VALUES(refresh_token), scope = VALUES(scope);`

		sql += AddUserGuilds + AddUserToGuild;	

		await this.GetQuery(sql);
	}

	public async UpdateDiscordAuth(DiscordDetails: DiscordResponse) {
		const sql = `INSERT IGNORE INTO WEB__users (access_token, refresh_token, scope, expires_in, token_type) VALUES ('${DiscordDetails.access_token}', '${DiscordDetails.refresh_token}', '${DiscordDetails.scope}', '${DiscordDetails.expires_in}', '${DiscordDetails.token_type}') ON DUPLICATE KEY UPDATE access_token = VALUES(access_token), refresh_token = VALUES(refresh_token), scope = VALUES(scope); `
	
		await this.GetQuery(sql);
	}

	
	public async GetGuildChannels(guild_id: string) {
		let sql = `SELECT channels.* FROM guild_to_channel LEFT JOIN channels ON guild_to_channel.channel_id = channels.channel_id WHERE guild_to_channel.guild_id = '${guild_id}'`

		return await this.GetQuery<{channel_id: string}>(sql);
	}

	public async GetChannelMessages(channel_id: string) {
		let sql = `SELECT * FROM ( SELECT channel_messages.*, guild_user.nickname, users.username FROM channel_messages, guild_user, users WHERE channel_messages.channel_id = '${channel_id}' AND channel_messages.author = guild_user.user_id AND channel_messages.author = users.id ORDER BY id DESC LIMIT 400 ) sub ORDER BY id ASC`;

		return (await this.GetQuery<ChannelMessage>(sql));
	}

	public async getGuildUsers(guild_id: string){
		const sql = `SELECT	guild_user.nickname,guild_user.display_hex_color,users.*,user_to_guild.permissions FROM	user_to_guild,guild_user,users WHERE user_to_guild.guild_id = '${guild_id}' AND guild_user.user_id = user_to_guild.user_id AND users.id = guild_user.user_id`

		return await this.GetQuery<GuildUsers>(sql);
	}

	public async UpdateUserBossMusic(user_id: string, fileName: string) {
		const sql = `UPDATE guild_user_boss_music SET song_name = '${fileName}.ogg' WHERE user_id = '${user_id}';`;

		await this.GetQuery(sql);
	}
}


interface GuildUsers {
	nickname: string,
	display_hex_color: string,
	id: string,
	username: string,
	discriminator: number,
	avatar: string
	bot: boolean,
	permissions: number
}
interface ChannelMessage {
	id: string,
	content: string,
	author: string,
	type: string,
	embeds?: string,
	attachments?: string,
	channel_id: string,
	is_pinned: boolean,
	is_deleted: boolean
}


interface WebsiteUser {
	user_id: string,
	access_token: string,
	refresh_token: string,
	Scope: string,
	expires_in: number,
	time_added: string,
	token_type: 'Bearer'
}