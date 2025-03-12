(async () => {
	let sampleRate = 48000;
	let length = 50;

	let writer = new WebMMuxer.Muxer({
		target: new WebMMuxer.ArrayBufferTarget(),
		video: {
			codec: 'V_VP9',
			width: 1280,
			height: 720,
			frameRate: 5
		},
		audio: {
			codec: 'A_OPUS',
			numberOfChannels: 1,
			sampleRate
		}
	});


	let audioEncoder = new AudioEncoder({
		output: (chunk, meta) => writer.addAudioChunk(chunk, meta),
		error: e => console.error(e)
	});
	audioEncoder.configure({
		codec: 'opus',
		numberOfChannels: 1,
		sampleRate,
		bitrate: 32000
	});

	let audioContext = new AudioContext();
	let audioBuffer = await audioContext.decodeAudioData(await (await fetch('./CantinaBand60.wav')).arrayBuffer());
	let data = new Float32Array(length * sampleRate);
	data.set(audioBuffer.getChannelData(0).subarray(0, data.length), 0);

	let audioData = new AudioData({
		format: 'f32',
		sampleRate,
		numberOfFrames: length * sampleRate,
		numberOfChannels: 1,
		timestamp: 0,
		data: data
	});
	audioEncoder.encode(audioData);
	audioData.close();

	await audioEncoder.flush();

	let canvas = document.createElement('canvas');
	canvas.setAttribute('width', '1280');
	canvas.setAttribute('height', '720');
	let ctx = canvas.getContext('2d');

	let videoEncoder = new VideoEncoder({
		output: (chunk, meta) => writer.addVideoChunk(chunk, meta),
		error: e => console.error(e)
	});
	videoEncoder.configure({
		codec: 'vp09.00.10.08',
		width: 1280,
		height: 720,
		bitrate: 1e6
	});

	for (let i = 0; i < length; i++) {
		ctx.fillStyle = ['red', 'lime', 'blue', 'yellow'][Math.floor(Math.random() * 4)];
		ctx.fillRect(Math.random() * 1280, Math.random() * 720, Math.random() * 1280, Math.random() * 720);

		let videoFrame = new VideoFrame(canvas, { timestamp: i * 1e6 });
		videoEncoder.encode(videoFrame);
		videoFrame.close();
	}

	await Promise.allSettled([videoEncoder.flush(), audioEncoder.flush()]);

	await writer.finalize();

	let { buffer } = writer.target;

	// Display encoded video on video element
	let video = document.getElementById('video');
	video.src = URL.createObjectURL(new Blob([buffer], { type: 'video/webm' }));
})();