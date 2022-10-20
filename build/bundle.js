"use strict";
(() => {
  // src/main.ts
  var WriteTarget = class {
    pos = 0;
    helper = new Uint8Array(8);
    helperView = new DataView(this.helper.buffer);
    writeU8(value) {
      this.helperView.setUint8(0, value);
      this.write(this.helper.subarray(0, 1));
    }
    writeUnsignedInt(value, width = measureUnsignedInt(value)) {
      switch (width) {
        case 5:
          this.writeU8(
            Math.floor(value / 2 ** 32)
          );
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
          throw new Error("Bad UINT size " + width);
      }
    }
    writeEBMLVarInt(value, width = measureEBMLVarInt(value)) {
      switch (width) {
        case 1:
          this.writeU8(1 << 7 | value);
          break;
        case 2:
          this.writeU8(1 << 6 | value >> 8);
          this.writeU8(value);
          break;
        case 3:
          this.writeU8(1 << 5 | value >> 16);
          this.writeU8(value >> 8);
          this.writeU8(value);
          break;
        case 4:
          this.writeU8(1 << 4 | value >> 24);
          this.writeU8(value >> 16);
          this.writeU8(value >> 8);
          this.writeU8(value);
          break;
        case 5:
          this.writeU8(1 << 3 | value / 4294967296 & 7);
          this.writeU8(value >> 24);
          this.writeU8(value >> 16);
          this.writeU8(value >> 8);
          this.writeU8(value);
          break;
        default:
          throw new Error("Bad EBML VINT size " + width);
      }
    }
    writeString(str) {
      this.write(new Uint8Array(str.split("").map((x) => x.charCodeAt(0))));
    }
    writeEBML(data) {
      if (Array.isArray(data)) {
        for (let elem of data) {
          this.writeEBML(elem);
        }
      } else {
        this.writeUnsignedInt(data.id);
        if (typeof data.data === "number") {
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
        } else if (typeof data.data === "string") {
          this.writeEBMLVarInt(data.data.length);
          this.writeString(data.data);
        }
      }
    }
  };
  var ArrayBufferWriteTarget = class extends WriteTarget {
    buffer = new ArrayBuffer(2 ** 24);
    bytes = new Uint8Array(this.buffer);
    constructor() {
      super();
    }
    write(data) {
      this.bytes.set(data, this.pos);
      this.pos += data.byteLength;
    }
    seek(newPos) {
      this.pos = newPos;
    }
    finalize() {
      return this.bytes.slice(0, this.pos);
    }
  };
  var measureUnsignedInt = (value) => {
    if (value < 1 << 8) {
      return 1;
    } else if (value < 1 << 16) {
      return 2;
    } else if (value < 1 << 24) {
      return 3;
    } else if (value < 2 ** 32) {
      return 4;
    } else {
      return 5;
    }
  };
  var measureEBMLVarInt = (value) => {
    if (value < (1 << 7) - 1) {
      return 1;
    } else if (value < (1 << 14) - 1) {
      return 2;
    } else if (value < (1 << 21) - 1) {
      return 3;
    } else if (value < (1 << 28) - 1) {
      return 4;
    } else if (value < 2 ** 35 - 1) {
      return 5;
    } else {
      throw new Error("EBML VINT size not supported " + value);
    }
  };
  var saveFile = (blob, filename = "unnamed.webm") => {
    const a = document.createElement("a");
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
  var target = new ArrayBufferWriteTarget();
  target.writeEBML({
    "id": 440786851,
    "data": [
      {
        "id": 17030,
        "data": 1
      },
      {
        "id": 17143,
        "data": 1
      },
      {
        "id": 17138,
        "data": 4
      },
      {
        "id": 17139,
        "data": 8
      },
      {
        "id": 17026,
        "data": "webm"
      },
      {
        "id": 17031,
        "data": 2
      },
      {
        "id": 17029,
        "data": 2
      }
    ]
  });
  var buffer = target.finalize();
  console.log(buffer);
  saveFile(new Blob([buffer]));
})();
