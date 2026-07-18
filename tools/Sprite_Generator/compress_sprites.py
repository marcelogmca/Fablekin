import os
import sys
import time
from pathlib import Path
from PIL import Image

def compress_sprites(input_dir, output_dir, quality=85):
    """
    Recursively compresses images from input_dir to output_dir using WebP.
    Maintains folder structure and uses an optimized compression threshold.
    """
    input_path = Path(input_dir).resolve()
    output_path = Path(output_dir).resolve()
    
    if not input_path.exists():
        print(f"Error: Input directory '{input_dir}' not found.")
        return

    # Supported image extensions
    extensions = {'.webp', '.png', '.jpg', '.jpeg', '.bmp', '.tiff'}
    
    print(f"--- Sprite Compression Started ---")
    print(f"Input:  {input_path}")
    print(f"Output: {output_path}")
    print(f"Quality: {quality}%")
    print(f"----------------------------------")
    
    start_time = time.time()
    processed_count = 0
    skipped_count = 0
    total_saved_bytes = 0

    # Walk through the directory tree
    for root, dirs, files in os.walk(input_path):
        for file in files:
            file_path = Path(root) / file
            
            # Check if it's an image we support
            if file_path.suffix.lower() in extensions:
                # Calculate relative path to maintain structure
                rel_path = file_path.relative_to(input_path)
                target_file_path = output_path / rel_path.with_suffix('.webp')
                
                # Create parent directories if they don't exist
                target_file_path.parent.mkdir(parents=True, exist_ok=True)
                
                try:
                    original_size = file_path.stat().st_size
                    
                    with Image.open(file_path) as img:
                        # method=6 is the slowest but provides the best compression ratio
                        # lossless=False ensures we use the quality parameter
                        img.save(target_file_path, 'WEBP', quality=quality, method=6, lossless=False)
                    
                    new_size = target_file_path.stat().st_size
                    saved = original_size - new_size
                    total_saved_bytes += saved
                    
                    print(f"[OK] {rel_path} ({original_size/1024:.1f}KB -> {new_size/1024:.1f}KB)")
                    processed_count += 1
                except Exception as e:
                    print(f"[ERROR] Failed to process {rel_path}: {e}")
            else:
                skipped_count += 1

    duration = time.time() - start_time
    print(f"----------------------------------")
    print(f"Compression Complete!")
    print(f"Processed: {processed_count} images")
    if skipped_count > 0:
        print(f"Skipped:   {skipped_count} non-image files")
    print(f"Total Saved: {total_saved_bytes / (1024*1024):.2f} MB")
    print(f"Time Taken:  {duration:.2f} seconds")
    print(f"----------------------------------")

if __name__ == "__main__":
    # Settings
    INPUT_FOLDER = "final_sprites"
    OUTPUT_FOLDER = "compressed_final_sprites"
    QUALITY = 85
    
    # Get absolute path relative to the script
    base_dir = Path(__file__).parent
    input_dir = base_dir / INPUT_FOLDER
    output_dir = base_dir / OUTPUT_FOLDER
    
    compress_sprites(input_dir, output_dir, quality=QUALITY)
