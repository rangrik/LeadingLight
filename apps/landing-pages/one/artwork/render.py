import bpy, math, os, random
from mathutils import Vector
root=os.path.dirname(os.path.abspath(__file__))
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.render.engine='CYCLES'; scene.cycles.samples=24; scene.cycles.use_denoising=True
scene.render.resolution_x=1600; scene.render.resolution_y=1333; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.film_transparent=True
scene.world.color=(0.35,0.40,0.29)
scene.view_settings.view_transform='AgX'

def mat(name,color,rough=.6):
 m=bpy.data.materials.new(name); m.diffuse_color=(*color,1);m.use_nodes=True
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=rough
 return m
paper=mat('Warm paper',(0.78,.76,.64),.82)
cover=mat('Forest cloth',(.028,.085,.047),.82)
ground=mat('Celadon backdrop',(.59,.68,.44),.9)
green=mat('Green cloth ribbon',(.15,.29,.08),.8)
metal=mat('Brushed silver',(.5,.55,.49),.3);metal.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value=.8

def box(name,loc,scale,ma,bevel=0.03):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(ma)
 if bevel:
  b=o.modifiers.new('Soft edges','BEVEL');b.width=bevel;b.segments=4
  o.modifiers.new('Normals','WEIGHTED_NORMAL')
 return o
box('Ground',(0,0,-.22),(200,200,.1),ground).is_shadow_catcher=True
book=bpy.data.objects.new('Book',None);bpy.context.collection.objects.link(book);book.rotation_euler.z=math.radians(-8)
for side in [-1,1]:
 o=box('Linen cover', (side*1.64,0,-.04),(3.30,4.74,.16),cover,.06);o.parent=book
# Texture paper pages.
def textured(name,path):
 ma=mat(name,(.85,.83,.73),.75);n=ma.node_tree.nodes.new('ShaderNodeTexImage');n.image=bpy.data.images.load(path);ma.node_tree.links.new(n.outputs['Color'],ma.node_tree.nodes.get('Principled BSDF').inputs['Base Color']);return ma
left=textured('Left printed page',root+'/left-page.png');right=textured('Right printed page',root+'/right-page.png')

def sheet(side,level,ma):
 verts=[];faces=[];nx=64;ny=12
 for j in range(ny+1):
  y=-2.23+j/ny*4.46
  for i in range(nx+1):
   x=i/nx*3.16
   z=.12+level*.018+.40*math.exp(-x*2.1)+.035*(x/3.16)**5
   if level==12: z+=.075*(x/3.16)**6*(.5+.5*math.sin(y+1))
   verts.append((side*(x+.03),y,z))
 for j in range(ny):
  for i in range(nx):
   a=j*(nx+1)+i;faces.append((a,a+1,a+nx+2,a+nx+1) if side==1 else (a+1,a,a+nx+1,a+nx+2))
 mesh=bpy.data.meshes.new('Page mesh');mesh.from_pydata(verts,[],faces);mesh.update()
 o=bpy.data.objects.new('Page',mesh);bpy.context.collection.objects.link(o);o.parent=book;mesh.materials.append(ma)
 uv=mesh.uv_layers.new()
 for poly in mesh.polygons:
  poly.use_smooth=True
  for li in poly.loop_indices:
   v=mesh.vertices[mesh.loops[li].vertex_index].co
   uv.data[li].uv=((v.x+.03)/3.16 if side==1 else (v.x+3.19)/3.16, (v.y+2.23)/4.46)
 mod=o.modifiers.new('Paper thickness','SOLIDIFY');mod.thickness=.008
 return o
for k in range(13):
 for s in [-1,1]:sheet(s,k,left if s==-1 and k==12 else right if s==1 and k==12 else paper)
# Ribbon between the pages, hanging beyond the book.
verts=[]
for j in range(70):
 y=2.3-j/69*5.6
 z=.58 if y>-.3 else .58-.35*min(1,(-y-.3)/2.3)
 if y<-2.4:z=.18-.28*math.sin(min(1,(-y-2.4)/.9)*math.pi/2)
 for x in [-.07,.07]:verts.append((x+.04,y,z))
faces=[(j*2,j*2+1,j*2+3,j*2+2) for j in range(69)]
me=bpy.data.meshes.new('Ribbon');me.from_pydata(verts,[],faces);o=bpy.data.objects.new('Bookmark',me);bpy.context.collection.objects.link(o);o.data.materials.append(green);o.parent=book;sol=o.modifiers.new('Thickness','SOLIDIFY');sol.thickness=.012
# Loose green index card behind the book.
card=box('Index card',(2.30,1.50,-.10),(2.3,3.1,.02),green,.025);card.rotation_euler.z=math.radians(23)
# Simple dark graphite pencil to the right.
pen=mat('Pencil',(.032,.062,.035),.38)
bpy.ops.mesh.primitive_cylinder_add(vertices=6,radius=.065,depth=3.7,location=(4.1,-.3,-.04),rotation=(math.pi/2,0,.15));bpy.context.object.data.materials.append(pen)
bpy.ops.mesh.primitive_cone_add(vertices=32,radius1=.065,radius2=0,depth=.23,location=(4.38,-2.24,-.04),rotation=(math.pi/2,0,.15));bpy.context.object.data.materials.append(metal)
# Big window light creates a quiet, long shadow.
bpy.ops.object.light_add(type='AREA',location=(-4,-3,8));key=bpy.context.object;key.data.energy=1050;key.data.shape='DISK';key.data.size=4;key.rotation_euler=(Vector((0,0,0))-key.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.light_add(type='AREA',location=(5,4,6));fill=bpy.context.object;fill.data.energy=130;fill.data.size=7;fill.rotation_euler=(Vector((0,0,0))-fill.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(7,-10,13));camera=bpy.context.object;target=Vector((.1,-.05,0));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=10.9;scene.camera=camera
scene.render.filepath=root+'/reading-room-cutout.png';bpy.ops.wm.save_as_mainfile(filepath=root+'/reading-room.blend');bpy.ops.render.render(write_still=True)
