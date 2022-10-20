type EBML = { id: number, data: number | string | EBML[], size?: number } | EBML[];

abstract class WriteTarget {
	pos = 0;
	helper = new Uint8Array(8);
	helperView = new DataView(this.helper.buffer);
	
	abstract write(data: Uint8Array): void;
	abstract seek(newPos: number): void;

	writeU8(value: number) {
		this.helperView.setUint8(0, value);
		this.write(this.helper.subarray(0, 1));
	}

	writeUnsignedInt(value: number, width: number = measureUnsignedInt(value)) {
		// Each case falls through:
		switch (width) {
			case 5:
			this.writeU8(
				Math.floor(value / 2**32));  // Need to use division to access >32 bits of floating point var
			case 4:
				this.writeU8(value >> 24);
			case 3:
				this.writeU8(value >> 16);
			case 2:
				this.writeU8(value >> 8);
			case 1:
				this.writeU8(value);
				break;
			default:
				throw new Error('Bad UINT size ' + width);
		}
	};

	writeEBMLVarInt(value: number, width: number = measureEBMLVarInt(value)) {
		switch (width) {
			case 1:
				this.writeU8((1 << 7) | value);
				break;
			case 2:
				this.writeU8((1 << 6) | (value >> 8));
				this.writeU8(value);
				break;
			case 3:
				this.writeU8((1 << 5) | (value >> 16));
				this.writeU8(value >> 8);
				this.writeU8(value);
				break;
			case 4:
				this.writeU8((1 << 4) | (value >> 24));
				this.writeU8(value >> 16);
				this.writeU8(value >> 8);
				this.writeU8(value);
				break;
			case 5:
				/*
				* JavaScript converts its doubles to 32-bit integers for bitwise
				* operations, so we need to do a division by 2^32 instead of a
				* right-shift of 32 to retain those top 3 bits
				*/
				this.writeU8((1 << 3) | ((value / 4294967296) & 0x7));
				this.writeU8(value >> 24);
				this.writeU8(value >> 16);
				this.writeU8(value >> 8);
				this.writeU8(value);
				break;
			default:
				throw new Error('Bad EBML VINT size ' + width);
		}
	};

	writeString(str: string) {
		this.write(new Uint8Array(str.split('').map(x => x.charCodeAt(0))));
	}

	writeEBML(data: EBML) {
		if (Array.isArray(data)) {
			for (let elem of data) {
				this.writeEBML(elem);
			}
		} else {
			this.writeUnsignedInt(data.id); // ID field

			if (typeof data.data === 'number') {
				let size = data.size ?? measureUnsignedInt(data.data);
				this.writeEBMLVarInt(size);
				this.writeUnsignedInt(data.data, size);
			} else if (Array.isArray(data.data)) {
				let sizePos = this.pos;

				this.seek(this.pos + 4);

				let startPos = this.pos;
				this.writeEBML(data.data);

				let size = this.pos - startPos;
				let endPos = this.pos;
				this.seek(sizePos);
				this.writeEBMLVarInt(size, 4);
				this.seek(endPos);
			} else if (typeof data.data === 'string') {
				this.writeEBMLVarInt(data.data.length);
				this.writeString(data.data);
			}
		}
	}
}

class ArrayBufferWriteTarget extends WriteTarget {
	buffer = new ArrayBuffer(2**24);
	bytes = new Uint8Array(this.buffer);

	constructor() {
		super();
	}

	write(data: Uint8Array) {
		this.bytes.set(data, this.pos);
		this.pos += data.byteLength;
	}

	seek(newPos: number) {
		this.pos = newPos;
	}

	finalize() {
		return this.bytes.slice(0, this.pos);
	}
}

const measureUnsignedInt = (value: number) => {
	// Force to 32-bit unsigned integer
	if (value < (1 << 8)) {
		return 1;
	} else if (value < (1 << 16)) {
		return 2;
	} else if (value < (1 << 24)) {
		return 3;
	} else if (value < 2**32) {
		return 4;
	} else {
		return 5;
	}
};

const measureEBMLVarInt = (value: number) => {
	if (value < (1 << 7) - 1) {
		/* Top bit is set, leaving 7 bits to hold the integer, but we can't store
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
	} else if (value < 2**35-1) {  // (can address 32GB)
		return 5;
	} else {
		throw new Error('EBML VINT size not supported ' + value);
	}
};

const saveFile = (blob: Blob, filename = 'unnamed.webm') => {
	const a = document.createElement('a');
	document.body.appendChild(a);
	const url = window.URL.createObjectURL(blob);
	a.href = url;
	a.download = filename;
	a.click();
	setTimeout(() => {
		window.URL.revokeObjectURL(url);
		document.body.removeChild(a);
	}, 0);
};

let target = new ArrayBufferWriteTarget();
target.writeEBML({
	'id': 0x1a45dfa3,  // EBML
	'data': [
	  {
		'id': 0x4286,  // EBMLVersion
		'data': 1
	  },
	  {
		'id': 0x42f7,  // EBMLReadVersion
		'data': 1
	  },
	  {
		'id': 0x42f2,  // EBMLMaxIDLength
		'data': 4
	  },
	  {
		'id': 0x42f3,  // EBMLMaxSizeLength
		'data': 8
	  },
	  {
		'id': 0x4282,  // DocType
		'data': 'webm'
	  },
	  {
		'id': 0x4287,  // DocTypeVersion
		'data': 2
	  },
	  {
		'id': 0x4285,  // DocTypeReadVersion
		'data': 2
	  }
	]
  });

let buffer = target.finalize();

console.log(buffer);
saveFile(new Blob([buffer]));