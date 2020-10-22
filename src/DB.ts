import { Pool, createPool, createConnection, Connection } from "mysql";
import { DiscordResponse } from ".";
import { username, password, host } from "../config";
export class DB {
	
	public pool: Pool;
    constructor() {
		this.pool = createPool({
			connectionLimit: 100,
			host,
			user: username,
			password,
			database: "DiscordWeb",
			multipleStatements: true,
			charset: "utf8mb4_general_ci",
			debug: false,
		});
	}

	private async GetQuery(query: string): Promise<[]> {
		return new Promise((resolve, reject) => {
			this.pool.query(query, (error, results) => {
				if (error) {
					reject(error);
				}
				resolve(results);
			});
		});
	}

	public async GetUserDetails(user_id: string): Promise<{access_token: string}[]> {
		let sql = `SELECT access_token FROM users WHERE user_id = '${user_id}'`

		return await this.GetQuery(sql);
	}

	public async AddDiscordAuth(id: string, DiscordDetails: DiscordResponse) {
		let sql = `INSERT INTO users (user_id, access_token, refresh_token, scope, expires_in, token_type) VALUES ('${id}', '${DiscordDetails.access_token}', '${DiscordDetails.refresh_token}', '${DiscordDetails.scope}', '${DiscordDetails.expires_in}', '${DiscordDetails.token_type}') ON DUPLICATE KEY UPDATE access_token = VALUES(access_token), refresh_token = VALUES(refresh_token), scope = VALUES(scope);`

		await this.GetQuery(sql);
	}
}