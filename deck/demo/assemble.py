import json, pathlib, subprocess, textwrap
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).parent
beats = json.loads((ROOT / "beats.json").read_text())

def run(args): subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
def dur(p): return float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",str(p)], text=True))
def stamp(x):
    ms=round(x*1000); return f"{ms//3600000:02d}:{(ms//60000)%60:02d}:{(ms//1000)%60:02d},{ms%1000:03d}"
font=ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 30)
def burn(directory, text):
    lines=textwrap.wrap(text, 78); probe=Image.new("RGB", (1440,900)); d=ImageDraw.Draw(probe); box=d.multiline_textbbox((0,0),"\n".join(lines),font=font,spacing=6); h=box[3]-box[1]+28
    for p in directory.glob("*.jpg"):
        im=Image.open(p).convert("RGB"); d=ImageDraw.Draw(im,"RGBA"); d.rectangle((28,900-h-24,1412,876),fill=(0,0,0,190)); d.multiline_text((44,900-h-10),"\n".join(lines),font=font,fill=(255,255,255,255),spacing=6); im.save(p,quality=85)

audio_list=[]; video_list=[]; now=0; srt=[]; captions=[]
for b in beats:
    wav=ROOT/f"beat-{b['id']}.wav"; audio_list.append(wav)
    length=dur(wav); srt.append(f"{b['id']}\n{stamp(now)} --> {stamp(now+length)}\n{b['text']}\n"); cap=ROOT/f"caption-{b['id']}.txt"; cap.write_text("\n".join(textwrap.wrap(b['text'], 78))); captions.append((cap,now,now+length)); now += length
    for j in range(len(b['scenes'])): burn(ROOT/f"frames-{b['id']}/scene-{j:03d}", b['text'])
    scene_videos=[]; cursor=0
    for j,scene in enumerate(b['scenes']):
        seconds=length*scene['share']; out=ROOT/f"scene-{b['id']}-{j}.mp4"
        run(["ffmpeg","-y","-framerate","8","-i",str(ROOT/f"frames-{b['id']}/scene-{j:03d}/%05d.jpg"),"-t",str(seconds),"-vf","scale=1440:900,format=yuv420p","-c:v","libx264","-preset","veryfast","-pix_fmt","yuv420p",str(out)])
        scene_videos.append(out)
    beat_list=ROOT/f"beat-{b['id']}.txt"; beat_list.write_text("\n".join(f"file '{p}'" for p in scene_videos)+"\n")
    beat_video=ROOT/f"beat-{b['id']}.mp4"; run(["ffmpeg","-y","-f","concat","-safe","0","-i",str(beat_list),"-c","copy",str(beat_video)]); video_list.append(beat_video)
(ROOT/"audio.txt").write_text("\n".join(f"file '{p}'" for p in audio_list)+"\n")
(ROOT/"video.txt").write_text("\n".join(f"file '{p}'" for p in video_list)+"\n")
(ROOT/"beats.srt").write_text("\n".join(srt))
run(["ffmpeg","-y","-f","concat","-safe","0","-i",str(ROOT/"audio.txt"),"-c","copy",str(ROOT/"all.wav")])
run(["ffmpeg","-y","-f","concat","-safe","0","-i",str(ROOT/"video.txt"),"-i",str(ROOT/"all.wav"),"-map","0:v","-map","1:a","-c:v","libx264","-preset","medium","-pix_fmt","yuv420p","-s","1440x900","-c:a","aac","-b:a","192k","-shortest",str(ROOT.parent/"demo.mp4")])
