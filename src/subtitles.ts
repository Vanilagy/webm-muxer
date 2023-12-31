export interface EncodedSubtitleChunk {
	body: Uint8Array,
	additions?: Uint8Array,
	timestamp: number,
	duration: number
}

export interface EncodedSubtitleChunkMetadata {
	decoderConfig?: {
		description: Uint8Array
	}
}

interface SubtitleEncoderOptions {
	output: (chunk: EncodedSubtitleChunk, metadata: EncodedSubtitleChunkMetadata) => unknown,
	error: (error: Error) => unknown
}

interface SubtitleEncoderConfig {
	codec: 'webvtt'
}

const cueBlockHeaderRegex = /(?:(.+?)\n)?((?:\d{2}:)?\d{2}:\d{2}.\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}.\d{3})/g;
const preambleStartRegex = /^WEBVTT.*?\n{2}/;
const timestampRegex = /(?:(\d{2}):)?(\d{2}):(\d{2}).(\d{3})/;
const inlineTimestampRegex = /<(?:(\d{2}):)?(\d{2}):(\d{2}).(\d{3})>/g;
const textEncoder = new TextEncoder();

export class SubtitleEncoder {
	#options: SubtitleEncoderOptions;
	#config: SubtitleEncoderConfig;
	#preambleSeen = false;
	#preambleBytes: Uint8Array;
	#preambleEmitted = false;

	constructor(options: SubtitleEncoderOptions) {
		this.#options = options;
	}

	configure(config: SubtitleEncoderConfig) {
		if (config.codec !== 'webvtt') {
			throw new Error("Codec must be 'webvtt'.");
		}

		this.#config = config;
	}

	encode(text: string) {
		if (!this.#config) {
			throw new Error('Encoder not configured.');
		}

		text = text.replace('\r\n', '\n').replace('\r', '\n');

		cueBlockHeaderRegex.lastIndex = 0;
		let match: RegExpMatchArray;

		if (!this.#preambleSeen) {
			if (!preambleStartRegex.test(text)) {
				let error = new Error('WebVTT preamble incorrect.');
				this.#options.error(error);
				throw error;
			}

			match = cueBlockHeaderRegex.exec(text);
			let preamble = text.slice(0, match?.index ?? text.length).trimEnd();

			if (!preamble) {
				let error = new Error('No WebVTT preamble provided.');
				this.#options.error(error);
				throw error;
			}

			this.#preambleBytes = textEncoder.encode(preamble);
			this.#preambleSeen = true;

			if (match) {
				text = text.slice(match.index);
				cueBlockHeaderRegex.lastIndex = 0;
			}
		}

		while (match = cueBlockHeaderRegex.exec(text)) {
			let notes = text.slice(0, match.index);
			let cueIdentifier = match[1] || '';
			let matchEnd = match.index + match[0].length;
			let bodyStart = text.indexOf('\n', matchEnd) + 1;
			let cueSettings = text.slice(matchEnd, bodyStart).trim();
			let bodyEnd = text.indexOf('\n\n', matchEnd);
			if (bodyEnd === -1) bodyEnd = text.length;

			let startTime = this.#parseTimestamp(match[2]);
			let endTime = this.#parseTimestamp(match[3]);
			let duration = endTime - startTime;

			let body = text.slice(bodyStart, bodyEnd);
			let additions = `${cueSettings}\n${cueIdentifier}\n${notes}`;

			// Replace in-body timestamps so that they're relative to the cue start time
			inlineTimestampRegex.lastIndex = 0;
			body = body.replace(inlineTimestampRegex, (match) => {
				let time = this.#parseTimestamp(match.slice(1, -1));
				let offsetTime = time - startTime;

				return `<${this.#formatTimestamp(offsetTime)}>`;
			});

			text = text.slice(bodyEnd).trimStart();
			cueBlockHeaderRegex.lastIndex = 0;

			let chunk: EncodedSubtitleChunk = {
				body: textEncoder.encode(body),
				additions: additions.trim() === '' ? undefined : textEncoder.encode(additions),
				timestamp: startTime * 1000,
				duration: duration * 1000
			};

			let meta: EncodedSubtitleChunkMetadata = {};
			if (!this.#preambleEmitted) {
				meta.decoderConfig = {
					description: this.#preambleBytes
				};
				this.#preambleEmitted = true;
			}

			this.#options.output(chunk, meta);
		}
	}

	#parseTimestamp(string: string) {
		let match = timestampRegex.exec(string);
		if (!match) throw new Error('Expected match.');

		return 60 * 60 * 1000 * Number(match[1] || '0') +
			60 * 1000 * Number(match[2]) +
			1000 * Number(match[3]) +
			Number(match[4]);
	}

	#formatTimestamp(timestamp: number) {
		let hours = Math.floor(timestamp / (60 * 60 * 1000));
		let minutes = Math.floor((timestamp % (60 * 60 * 1000)) / (60 * 1000));
		let seconds = Math.floor((timestamp % (60 * 1000)) / 1000);
		let milliseconds = timestamp % 1000;

		return hours.toString().padStart(2, '0') + ':' +
			minutes.toString().padStart(2, '0') + ':' +
			seconds.toString().padStart(2, '0') + '.' +
			milliseconds.toString().padStart(3, '0');
	}
}