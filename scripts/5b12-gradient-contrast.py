import sys,os,json,re,math
from pathlib import Path
sys.path.insert(0,os.environ.get('PDF_VERIFICATION_TOOLS',str(Path(os.environ['TEMP'])/'opencode/pdf-verification')))
from PIL import Image
im=Image.open(sys.argv[1]).convert('RGB');b=json.loads(sys.argv[2]);t=b['text'];sx=im.width/b['width'];sy=im.height/b['height'];fg=[int(x) for x in re.findall(r'\d+',b['foreground'])[:3]]
def lum(rgb):
    a=[v/255 for v in rgb];a=[v/12.92 if v<=0.04045 else ((v+0.055)/1.055)**2.4 for v in a];return sum(v*c for v,c in zip(a,[0.2126,0.7152,0.0722]))
def ratio(a,z):
    x,y=lum(a),lum(z);return(max(x,y)+0.05)/(min(x,y)+0.05)
pixels=[im.getpixel((x,y)) for y in range(max(0,math.floor(t['top']*sy)),min(im.height,math.ceil(t['bottom']*sy))) for x in range(max(0,math.floor(t['left']*sx)),min(im.width,math.ceil(t['right']*sx)))]
print(json.dumps({'method':'Painted background in complete text range, text hidden only for background capture and immediately restored','minimumContrast':min(ratio(fg,p) for p in pixels),'pixels':len(pixels),'foreground':fg,'backgroundOnlyImage':sys.argv[1]},ensure_ascii=True))
