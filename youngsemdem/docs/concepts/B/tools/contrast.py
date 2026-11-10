import sys
def lum(h):
    h=h.lstrip('#'); r,g,b=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    f=lambda c: c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)
def cr(a,b):
    la,lb=lum(a),lum(b); hi,lo=max(la,lb),min(la,lb); return (hi+0.05)/(lo+0.05)
pairs=[l.split() for l in sys.stdin if l.strip() and not l.startswith('#')]
for p in pairs:
    fg,bg,label=p[0],p[1],' '.join(p[2:])
    r=cr(fg,bg); g='AAA' if r>=7 else 'AA' if r>=4.5 else 'AA-large' if r>=3 else 'FAIL'
    print(f"{label:40s} {fg} on {bg}: {r:5.2f} {g}")
