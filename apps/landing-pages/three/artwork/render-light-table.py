import bpy, math, os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 12
scene.cycles.transmission_bounces = 10
scene.cycles.device = 'CPU'
scene.render.resolution_x = 1600
scene.render.resolution_y = 1400
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = os.path.join(ROOT, 'artwork', 'light-table.png')
scene.world.color = (0.025, 0.025, 0.019)
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'


def material(name, color, roughness=0.2, metallic=0, transmission=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    p = mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Transmission Weight'].default_value = transmission
    p.inputs['IOR'].default_value = 1.47
    return mat

smoke = material('Optical glass', (0.9, 0.96, 0.72), 0.06, 0, 1)
yellow = material('Sulfur glass', (0.78, 0.9, 0.012), 0.08, 0, 0.78)
chrome = material('Dark satin rim', (0.22, 0.23, 0.17), 0.19, 0.92)
black = material('Warm black studio', (0.009, 0.01, 0.007), 0.32, 0.2)
matte = material('Engraved black', (0.015, 0.016, 0.01), 0.38, 0.6)
beam = bpy.data.materials.new('Incident light')
beam.use_nodes = True
bsdf = beam.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Base Color'].default_value = (0.8, 1, 0.04, 1)
bsdf.inputs['Emission Color'].default_value = (0.75, 1, 0.005, 1)
bsdf.inputs['Emission Strength'].default_value = 3.5


def bevel(obj, amount=0.03, segments=4):
    mod = obj.modifiers.new('Polished edges', 'BEVEL')
    mod.width = amount
    mod.segments = segments
    obj.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')


def cube(name, loc, scale, mat, bevel_width=0.02):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    bevel(obj, bevel_width)
    return obj


def rod(name, a, b, radius, mat):
    direction = Vector(b) - Vector(a)
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=radius, depth=direction.length, location=(Vector(a)+Vector(b))/2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = direction.to_track_quat('Z','Y').to_euler()
    obj.data.materials.append(mat)
    return obj


bpy.ops.mesh.primitive_plane_add(size=200, location=(0,0,-0.03))
bpy.context.object.data.materials.append(black)
# Three aligned lenses make the sculpture read as one instrument.
for i, (depth, radius) in enumerate([(-0.6, 1.56), (0.12, 1.73), (0.88, 1.9)]):
    center=(0.25, depth, 2.06)
    bpy.ops.mesh.primitive_cylinder_add(vertices=192, radius=radius, depth=0.14, location=center, rotation=(math.radians(90),0,0))
    lens=bpy.context.object
    lens.name=f'Glass lens {i+1}'
    lens.data.materials.append(yellow if i==2 else smoke)
    bevel(lens,0.065,5)
    bpy.ops.object.shade_smooth()
    for offset in [-0.075, 0.075]:
        bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=0.035, major_segments=160, minor_segments=16, location=(center[0],depth+offset,center[2]),rotation=(math.radians(90),0,0))
        bpy.context.object.data.materials.append(chrome if i<2 else yellow)
    # Engraved radial increments give the glass a precise optical character.
    for tick in range(72):
        angle=tick*math.tau/72
        outer=radius-0.09
        inner=outer-(0.09 if tick%6==0 else 0.035)
        rod('Lens increment', (center[0]+inner*math.cos(angle), depth-0.081, center[2]+inner*math.sin(angle)), (center[0]+outer*math.cos(angle),depth-0.081,center[2]+outer*math.sin(angle)),0.004,chrome)

# A quiet machined base anchors the optical elements.
base=cube('Instrument base',(0.25,0.2,0.13),(3.65,2.25,0.26),matte,0.08)
for y in [-0.6,0.12,0.88]:
    rod('Lens mount',(.25,y,.22),(.25,y,.65),.045,chrome)
# One physical filament of light continues through all three lenses.
rod('Through line',(-3,-3,1.0),(2.2,3.4,3.4),0.008,beam)


def area(name, loc, energy, color, size, target, size_y=None):
    data=bpy.data.lights.new(name,'AREA')
    data.energy=energy
    data.color=color
    data.shape='RECTANGLE'
    data.size=size
    data.size_y=size_y or size
    obj=bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(obj)
    obj.location=loc
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()

area('Long softbox',(-4,-2,7),1500,(1,0.98,0.88),4,(0,0,1.5),1)
area('Silver edge',(4,2,6),2100,(0.9,0.96,1),3,(0,0,1.5),0.4)
area('Yellow transmission',(-0.5,4,2),1900,(0.8,1,0.12),3,(0,0,1.7),3)
area('Front ribbon',(0,-6,3.4),500,(1,1,0.8),2,(0,0,2),0.3)

bpy.ops.object.camera_add(location=(6.7,-9,5.4))
camera=bpy.context.object
camera.rotation_euler=(Vector((0.0,0.35,1.75))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO'
camera.data.ortho_scale=7.3
scene.camera=camera
scene.render.film_transparent=False
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'artwork','light-table.blend'))
bpy.ops.render.render(write_still=True)
