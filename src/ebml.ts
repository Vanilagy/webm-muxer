export interface EBMLElement {
	id: number,
	size?: number,
	data: number | string | Uint8Array | EBMLFloat32 | EBMLFloat64 | EBML[]
}

export type EBML = EBMLElement | Uint8Array | EBML[];

export class EBMLFloat32 {
	value: number;

	constructor(value: number) {
		this.value = value;
	}
}

export class EBMLFloat64 {
	value: number;

	constructor(value: number) {
		this.value = value;
	}
}

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
	CueClusterPosition = 0xf1
}