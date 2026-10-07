"""Unity プロジェクトのモデル・テクスチャを WebAR 用 (glb / jpg) に変換する。

Unity 版リポジトリ (KogaLabSojo/preparedness) がこのリポジトリと同じ階層にある前提。
別の場所にある場合は環境変数 PREPAREDNESS_UNITY_ASSETS に Assets フォルダのパスを指定する。

実行:
  blender -b --factory-startup -P tools/convert_assets.py
"""
import os
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
WEBAR = os.path.dirname(HERE)
UNITY = os.environ.get("PREPAREDNESS_UNITY_ASSETS") or os.path.join(
    os.path.dirname(WEBAR), "preparedness", "Preparedness_Unity", "Preparedness", "Assets"
)
OUT_MODELS = os.path.join(WEBAR, "public", "models")
OUT_TEX = os.path.join(WEBAR, "public", "textures")
MAX_TEX = 1024

os.makedirs(OUT_MODELS, exist_ok=True)
os.makedirs(OUT_TEX, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def shrink(img, max_size=MAX_TEX):
    w, h = img.size
    if max(w, h) > max_size:
        s = max_size / max(w, h)
        img.scale(max(1, int(w * s)), max(1, int(h * s)))


def export_glb(path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_image_format="JPEG",
        export_jpeg_quality=85,
        export_yup=True,
        export_apply=True,
        export_animations=False,
        export_skins=False,
        export_morph=False,
    )


def crop_top(img, ratio):
    """画像上端の余白を切り落とす（Blender の画素は下の行から並ぶ）"""
    w, h = img.size
    keep = int(h * (1.0 - ratio))
    px = list(img.pixels[: w * keep * 4])
    cropped = bpy.data.images.new(img.name + "_crop", w, keep, alpha=True)
    cropped.colorspace_settings.name = img.colorspace_settings.name
    cropped.pixels[:] = px
    return cropped


def convert_texture(src, name, max_size=MAX_TEX, crop_top_ratio=0.0):
    reset()
    img = bpy.data.images.load(src)
    if crop_top_ratio > 0:
        img = crop_top(img, crop_top_ratio)
    shrink(img, max_size)
    img.filepath_raw = os.path.join(OUT_TEX, name)
    img.file_format = "JPEG"
    img.save()
    print("texture:", name, tuple(img.size))


def convert_block_wall():
    reset()
    bpy.ops.import_scene.fbx(filepath=os.path.join(UNITY, "Scenes", "3DModel", "b.fbx"))
    tex_dir = os.path.join(UNITY, "Scenes", "3DModel")

    mat = bpy.data.materials.new("ConcreteBlock")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")

    def tex(file, non_color=False):
        img = bpy.data.images.load(os.path.join(tex_dir, file))
        shrink(img)
        if non_color:
            img.colorspace_settings.is_data = True
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        return node

    base = tex("Material_Base_color.png")
    nt.links.new(base.outputs["Color"], bsdf.inputs["Base Color"])
    rough = tex("Material_Roughness.png", non_color=True)
    nt.links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])
    normal = tex("Material_Normal_OpenGL.png", non_color=True)
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = 2.0
    nt.links.new(normal.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Metallic"].default_value = 0.0

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(mat)
        # 各ブロックの原点をジオメトリ中心へ（物理演算で個別に扱うため）
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")

    # 塀全体の底面中央を原点に
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector(map(min, mn, w))
            mx = Vector(map(max, mx, w))
    offset = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    for i, o in enumerate(sorted(meshes, key=lambda o: o.name)):
        o.location -= offset
        o.name = f"block_{i:02d}"
    print("block wall size:", tuple(round(v, 3) for v in (mx - mn)))
    export_glb(os.path.join(OUT_MODELS, "block_wall.glb"))


def convert_pole():
    reset()
    bpy.ops.import_scene.fbx(
        filepath=os.path.join(UNITY, "Scenes", "disaster image", "3", "Pole2.fbx")
    )
    keep = None
    for o in list(bpy.context.scene.objects):
        if o.type == "MESH" and o.parent is None and keep is None:
            keep = o
    for o in list(bpy.context.scene.objects):
        if o is not keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for img in bpy.data.images:
        if img.size[0] > 0:
            shrink(img)

    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for v in keep.data.vertices:
        w = keep.matrix_world @ v.co
        mn = Vector(map(min, mn, w))
        mx = Vector(map(max, mx, w))
    # 根元（最下点）の中心を原点に
    keep.location -= Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    keep.name = "pole"
    print("pole size:", tuple(round(v, 3) for v in (mx - mn)))
    export_glb(os.path.join(OUT_MODELS, "pole.glb"))


convert_block_wall()
convert_pole()
convert_texture(os.path.join(UNITY, "462549934_567214299017057_4722858003746450879_n.jpg"), "asphalt.jpg", crop_top_ratio=0.08)
convert_texture(os.path.join(UNITY, "Scenes", "disaster image", "926623.jpg"), "concrete.jpg")
convert_texture(os.path.join(UNITY, "24265759.jpg"), "water_albedo.jpg")
convert_texture(os.path.join(UNITY, "Materials", "Water", "9aeedfa5f8f587df26793fe3d5e40a2a25551306.jpeg"), "water_normal.jpg")
print("DONE")
