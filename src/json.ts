/**
 * Pretty-prints a response body and remembers which line each path landed on.
 *
 * `JSON.stringify` plus a text search would be shorter and would pick the
 * wrong line the moment two fields hold the same value — which, in a table, is
 * most of the time. Printing it ourselves is the only way to be exact, and the
 * paths follow the same convention the recorder uses.
 */
export interface PrintedJson {
	text: string;
	lineOfPath: Map<string, number>;
}

const INDENT = "  ";

export function print(value: unknown): PrintedJson {
	const lines: string[] = [];
	const lineOfPath = new Map<string, number>();

	const write = (text: string, path?: string): void => {
		if (path !== undefined) lineOfPath.set(path, lines.length);
		lines.push(text);
	};

	const walk = (
		node: unknown,
		path: string,
		depth: number,
		prefix: string,
		comma: string,
	): void => {
		const pad = INDENT.repeat(depth);

		if (Array.isArray(node)) {
			write(`${pad}${prefix}[`, path);
			node.forEach((item, index) => {
				walk(
					item,
					`${path}[${index}]`,
					depth + 1,
					"",
					index === node.length - 1 ? "" : ",",
				);
			});
			write(`${pad}]${comma}`);
			return;
		}

		if (node !== null && typeof node === "object") {
			const entries = Object.entries(node);
			write(`${pad}${prefix}{`, path);
			entries.forEach(([key, item], index) => {
				const childPath = path ? `${path}.${key}` : key;
				walk(
					item,
					childPath,
					depth + 1,
					`"${key}": `,
					index === entries.length - 1 ? "" : ",",
				);
			});
			write(`${pad}}${comma}`);
			return;
		}

		write(
			`${pad}${prefix}${JSON.stringify(node) ?? "undefined"}${comma}`,
			path,
		);
	};

	walk(value, "", 0, "", "");
	return { text: lines.join("\n"), lineOfPath };
}
