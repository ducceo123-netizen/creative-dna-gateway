"""Deterministic synthetic UI test images. No product images or AI generation."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import sys

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
font_path = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
bold_path = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
def font(size, bold=False):
    return ImageFont.truetype(bold_path if bold else font_path, size)

slots = ['banner_desktop', 'banner_mobile', 'detail_01', 'detail_02', 'detail_03', 'detail_main', 'gtk_01', 'gtk_02', 'gtk_03', 'occasion_icon_01', 'occasion_icon_02', 'occasion_icon_03', 'occasion_icon_04', 'occasion_01', 'occasion_02', 'wyl_01', 'wyl_02', 'wyl_03']
for rev in ['before', 'current']:
    for i, slot in enumerate(slots):
        w, h = (1280, 600) if slot == 'banner_desktop' else (640, 760) if slot == 'banner_mobile' else (640, 640)
        bg = (242, 237, 226) if rev == 'current' else (230, 235, 241)
        accent = (45, 102, 80) if rev == 'current' else (75, 89, 126)
        im = Image.new('RGB', (w, h), bg)
        d = ImageDraw.Draw(im)
        # Abstract sample: a geometric card, never a real merchant product.
        center = (w // 2, h // 2)
        radius = min(w, h) // 4
        d.ellipse((center[0]-radius-30, center[1]-radius-30, center[0]+radius+30, center[1]+radius+30), fill=(255,255,255))
        x0, y0, x1, y1 = center[0]-radius, center[1]-radius, center[0]+radius, center[1]+radius
        d.rounded_rectangle((x0,y0,x1,y1), radius=32, fill=accent)
        d.line((x0+24,center[1],x1-24,center[1]), fill=(255,255,255), width=5)
        d.line((center[0],y0+24,center[0],y1-24), fill=(255,255,255), width=5)
        d.text((w//2, 24), 'SYNTHETIC QA / NOT A PRODUCT', font=font(22, True), fill=accent, anchor='mt')
        d.text((w//2, h-84), slot.replace('_', ' ').upper(), font=font(24, True), fill=accent, anchor='mt')
        d.text((w//2, h-46), f'{rev.upper()} FIXTURE  |  LOCAL UI TEST ONLY', font=font(18), fill=accent, anchor='mt')
        im.save(out / f'{rev}-{slot}.png', optimize=True)
