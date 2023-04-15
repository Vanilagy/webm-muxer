export const readBits = (bytes: Uint8Array, start: number, end: number) => {
	let result = 0;

	for (let i = start; i < end; i++) {
		let byteIndex = Math.floor(i / 8);
		let byte = bytes[byteIndex];
		let bitIndex = 0b111 - (i & 0b111);
		let bit = (byte & (1 << bitIndex)) >> bitIndex;

		result <<= 1;
		result |= bit;
	}

	return result;
};

export const writeBits = (bytes: Uint8Array, start: number, end: number, value: number) => {
	for (let i = start; i < end; i++) {
		let byteIndex = Math.floor(i / 8);
		let byte = bytes[byteIndex];
		let bitIndex = 0b111 - (i & 0b111);

		byte &= ~(1 << bitIndex);
		byte |= ((value & (1 << (end - i - 1))) >> (end - i - 1)) << bitIndex;
		bytes[byteIndex] = byte;
	}
};