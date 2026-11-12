param([Parameter(Mandatory=$true)][string]$ImagePath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Collections.Generic;
using System.Linq;
public static class PeriodMenuPixels {
 public static double L(Color c){double[] p={c.R/255.0,c.G/255.0,c.B/255.0};for(int i=0;i<3;i++)p[i]=p[i]<=0.04045?p[i]/12.92:Math.Pow((p[i]+0.055)/1.055,2.4);return p[0]*0.2126+p[1]*0.7152+p[2]*0.0722;}
 public static object[] Measure(string path){using(var b=new Bitmap(path)){var rows=new List<object>();for(int i=0;i<4;i++){int y=(int)(2+(i+0.5)*(b.Height-4)/4);var bg=b.GetPixel(b.Width-12,y);var colors=new Dictionary<int,int>();for(int py=Math.Max(2,y-11);py<Math.Min(b.Height-2,y+11);py++)for(int x=12;x<Math.Min(300,b.Width-12);x++){int rgb=b.GetPixel(x,py).ToArgb();if(rgb!=bg.ToArgb())colors[rgb]=colors.ContainsKey(rgb)?colors[rgb]+1:1;}var fg=Color.FromArgb(colors.OrderByDescending(p=>p.Value).First().Key);double a=L(bg),f=L(fg);rows.Add(new{optionIndex=i,background=String.Format("#{0:X2}{1:X2}{2:X2}",bg.R,bg.G,bg.B),foreground=String.Format("#{0:X2}{1:X2}{2:X2}",fg.R,fg.G,fg.B),ratio=(Math.Max(a,f)+0.05)/(Math.Min(a,f)+0.05)});}return rows.ToArray();}}
}
'@ -ReferencedAssemblies @('System.Drawing.Common','System.Drawing.Primitives','System.Linq','System.Collections')
[PeriodMenuPixels]::Measure($ImagePath)|ConvertTo-Json -Compress
