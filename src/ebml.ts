export interface EBMLElement {
	id: number,
	size?: number,
	data: number | string | Uint8Array | EBMLFloat32 | EBMLFloat64 | EBML[]
}

export type EBML = EBMLElement | Uint8Array | EBML[];

/** Wrapper around a number to be able to differentiate it in the writer. */
export class EBMLFloat32 {
	value: number;

	constructor(value: number) {
		this.value = value;
	}
}

/** Wrapper around a number to be able to differentiate it in the writer. */
export class EBMLFloat64 {
	value: number;

	constructor(value: number) {
		this.value = value;
	}
}

/** Defines some of the EBML IDs used by Matroska files. */
export enum EBMLId {
	EBML = 0x1a45dfa3,
	EBMLVersion = 0x4286,
	EBMLReadVersion = 0x42f7,
	EBMLMaxIDLength = 0x42f2,
	EBMLMaxSizeLength = 0x42f3,
	DocType = 0x4282,
	DocTypeVersion = 0x4287,
	DocTypeReadVersion = 0x4285,
	SeekHead = 0x114d9b74,
	Seek = 0x4dbb,
	SeekID = 0x53ab,
	SeekPosition = 0x53ac,
	Duration = 0x4489,
	Info = 0x1549a966,
	TimestampScale = 0x2ad7b1,
	MuxingApp = 0x4d80,
	WritingApp = 0x5741,
	Tracks = 0x1654ae6b,
	TrackEntry = 0xae,
	TrackNumber = 0xd7,
	TrackUID = 0x73c5,
	TrackType = 0x83,
	CodecID = 0x86,
	CodecPrivate = 0x63a2,
	DefaultDuration = 0x23e383,
	Video = 0xe0,
	PixelWidth = 0xb0,
	PixelHeight = 0xba,
	Void = 0xec,
	Audio = 0xe1,
	SamplingFrequency = 0xb5,
	Channels = 0x9f,
	BitDepth = 0x6264,
	Segment = 0x18538067,
	SimpleBlock = 0xa3,
	Cluster = 0x1f43b675,
	Timestamp = 0xe7,
	Cues = 0x1c53bb6b,
	CuePoint = 0xbb,
	CueTime = 0xb3,
	CueTrackPositions = 0xb7,
	CueTrack = 0xf7,
	CueClusterPosition = 0xf1,
	Colour = 0x55b0,
	MatrixCoefficients = 0x55b1,
	TransferCharacteristics = 0x55ba,
	Primaries = 0x55bb,
	Range = 0x55b9,
	AlphaMode = 0x53c0
}

export const measureUnsignedInt = (value: number) => {
	// Force to 32-bit unsigned integer
	if (value < (1 << 8)) {
		return 1;
	} else if (value < (1 << 16)) {
		return 2;
	} else if (value < (1 << 24)) {
		return 3;
	} else if (value < 2**32) {
		return 4;
	} else if (value < 2**40) {
		return 5;
	} else {
		return 6;
	}
};

export const measureEBMLVarInt = (value: number) => {
	if (value < (1 << 7) - 1) {
		/** Top bit is set, leaving 7 bits to hold the integer, but we can't store
		 * 127 because "all bits set to one" is a reserved value. Same thing for the
		 * other cases below:
		 */
		return 1;
	} else if (value < (1 << 14) - 1) {
		return 2;
	} else if (value < (1 << 21) - 1) {
		return 3;
	} else if (value < (1 << 28) - 1) {
		return 4;
	} else if (value < 2**35-1) {
		return 5;
	} else if (value < 2**42-1) {
		return 6;
	} else {
		throw new Error('EBML VINT size not supported ' + value);
	}
};