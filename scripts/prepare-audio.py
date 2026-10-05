"""Rebuild single-transient CC0 connection clips from a local source MP3.
Usage: python3 scripts/prepare-audio.py /path/to/257245_4286987-hq.mp3
Source URL and license: public/audio/CREDITS.txt. Requires ffmpeg.
"""
import array, pathlib, subprocess, sys, tempfile, wave
root=pathlib.Path(__file__).resolve().parent.parent
for index,(start,end) in enumerate([(0.18,0.24),(2.38,2.45),(3.06,3.10)],1):
    with tempfile.NamedTemporaryFile(suffix='.wav') as temp:
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',sys.argv[1],'-af',f'atrim=start={start}:end={end},asetpts=PTS-STARTPTS,volume=-12dB','-c:a','pcm_s16le',temp.name],check=True)
        with wave.open(temp.name) as f:
            params=f.getparams();samples=array.array('h',f.readframes(f.getnframes()))
        peak=max(map(abs,samples));assert peak>10,'Empty recording'
        gain=16384/peak;frames=len(samples)//params.nchannels
        for n in range(len(samples)):
            frame=n//params.nchannels
            fade=min(1,frame/(params.framerate*.001),(frames-1-frame)/(params.framerate*.012))
            samples[n]=round(samples[n]*gain*max(0,fade))
        with wave.open(str(root/'public/audio'/f'connect-{index}.wav'),'wb') as f:
            f.setparams(params);f.writeframes(samples.tobytes())
