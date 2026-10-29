import bpy, math, os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.render.resolution_x = 1500
scene.render.resolution_y = 1500
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.film_transparent = True
scene.view_settings.view_transform = 'AgX'
scene.world.color = (.22, .22, .22)

def material(name, color, metallic=0, rough=.25):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = rough
    return m

chrome = material('Polished aluminium', (.72,.76,.8), 1, .12)
blue = material('Cobalt enamel', (.012,.055,.8), .12, .2)
yellow = material('Sulfur ceramic', (.8,.95,.035), .05, .23)

def aim(obj, point=(0,0,0)):
    obj.rotation_euler = (Vector(point)-obj.location).to_track_quat('-Z','Y').to_euler()

def area(name, loc, power, size, color=(1,1,1), size_y=None):
    bpy.ops.object.light_add(type='AREA', location=loc)
    o = bpy.context.object
    o.name=name
    o.data.energy=power
    o.data.color=color
    o.data.shape='RECTANGLE'
    o.data.size=size
    o.data.size_y=size_y or size
    aim(o)

area('Long softbox', (1,-5,6), 1800, 5, size_y=2)
area('Tall softbox', (-6,-1,2), 1400, 3, size_y=7)
area('Edge strip', (5,2,4), 2200, 2, size_y=6)
area('Low fill', (0,3,-3), 1100, 4, (.65,.76,1))
bpy.ops.object.camera_add(location=(6,-9,6.2))
camera=bpy.context.object
aim(camera)
camera.data.type='ORTHO'
camera.data.ortho_scale=7.4
scene.camera=camera

def smooth(o, mat):
    o.data.materials.append(mat)
    if o.type=='MESH':
        for face in o.data.polygons: face.use_smooth=True
    return o

def render(name, objects):
    scene.render.filepath=os.path.join(ROOT,'design',name+'-draft.png')
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'design',name+'.blend'))
    bpy.ops.render.render(write_still=True)
    for o in objects: bpy.data.objects.remove(o, do_unlink=True)

curve=bpy.data.curves.new('A single connected thought','CURVE')
curve.dimensions='3D'
curve.resolution_u=16
curve.bevel_depth=.34
curve.bevel_resolution=8
spline=curve.splines.new('POLY')
spline.points.add(511)
for i,p in enumerate(spline.points):
    t=2*math.pi*i/512
    r=1.7+.65*math.cos(3*t)
    p.co=(r*math.cos(2*t),r*math.sin(2*t),.85*math.sin(3*t),1)
spline.use_cyclic_u=True
knot=bpy.data.objects.new('Idea: a trefoil knot',curve)
bpy.context.collection.objects.link(knot)
knot.rotation_euler=(.22,-.25,.4)
smooth(knot,chrome)
render('idea',[knot])

def cube(name, location, scale, rotation, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    o=bpy.context.object
    o.name=name
    o.scale=scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.rotation_euler=rotation
    bevel=o.modifiers.new('Soft machined edges','BEVEL')
    bevel.width=.12
    bevel.segments=5
    o.modifiers.new('Weighted face normals','WEIGHTED_NORMAL')
    smooth(o,mat)
    return o

objects=[]
for x,angle in [(-.9,-.28),(.9,.28)]:
    objects.append(cube('Book: folded planes',(x,0,.3),(1.9,3,.32),(0,angle,0),blue))
objects.append(cube('Book: supporting volume',(0,0,-.3),(3.55,2.8,.3),(0,0,-.12),blue))
camera.location=(6,-8,7)
aim(camera)
camera.data.ortho_scale=6
render('book',objects)

objects=[]
bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=64, radius=.86, location=(0,0,1.25))
objects.append(smooth(bpy.context.object,yellow))
bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=64, radius=1, location=(0,0,-.6))
body=bpy.context.object
body.scale=(1.2,1.2,1.5)
objects.append(smooth(body,yellow))
camera.location=(5,-9,4)
aim(camera)
camera.data.ortho_scale=6
render('person',objects)
