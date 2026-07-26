/**
 * Pretty-prints a response body and remembers which line each path landed on.
 *
 * `JSON.stringify` plus a text search would be shorter and would pick the
 * wrong line the moment two fields hold the same value — which, in a table, is
 * most of the time. Printing it ourselves is the only way to be exact.
 *
 * The paths come out of `childPath`, the same function the recorder writes them
 * with, and not a second copy of the convention: what the panel is asked for is
 * a path the recorder produced, so the two agreeing is what makes the lookup
 * work at all. A copy that drifted would not fail — it would mark a line, and
 * the wrong one.
 */
import { childPath } from "../shared/path";

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
					childPath(path, String(index), true),
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
				walk(
					item,
					childPath(path, key, false),
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
