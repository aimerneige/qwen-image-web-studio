import torch
from diffusers import DiffusionPipeline

print("正在安全加载管线元数据...")
pipeline = DiffusionPipeline.from_pretrained(
    "Qwen/Qwen-Image-2.1", 
    torch_dtype=torch.bfloat16
)

# 关键修改：开启极端的层级卸载，彻底保护主板内存与显存
pipeline.enable_sequential_cpu_offload()

prompt = "1girl, Kousaka Honoka, school uniform, chibi, transparent background, highly detailed"

print("开始生成...")
print("注意：由于采用了极致卸载策略，硬盘会频繁读取，生成速度会比常驻显存慢得多。")
print("你可以打开另一个终端运行 htop 和 nvtop，安心观察内存和显存的平稳水位。")

image = pipeline(prompt, num_inference_steps=28, output_type="pil").images[0]
image.save("honoka_transparent.png")
print("生成完毕：honoka_transparent.png")
