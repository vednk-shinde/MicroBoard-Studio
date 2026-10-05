"""Clean a folder-per-class image set and generate YOLO boxes for detection training.

The source images (from import_classification_set.py) have a class but no boxes, and many are not
photos of the component at all (people, text graphics, diagrams, unrelated products). Three checks:
  1. CLIP (zero-shot) decides whether the image is a photo of the component or of something else
     (a person, a diagram, a poster, a console, ...).
  2. YOLO-World, prompted with the component name only, finds the box(es). Adding distractor prompts to
     YOLO-World was tested and distorts its scores, so it gets the component prompt alone.
  3. CLIP checks the cropped box against all component classes; if the crop looks like a different
     component, the image is rejected rather than mislabelled.
  Also: CLIP rejects drawings/diagrams/infographics of the component (we want photos), and for clean
  product photos on a plain background that YOLO-World can't box, the box is the extent of the
  non-background pixels (still subject to the crop check).
Kept boxes become YOLO labels; every decision is written to autolabel_log.csv, and contact sheets of
kept and rejected images are saved for visual review.

Usage:
    python ml/component_detection/autolabel.py <source_dir> <out_dir> [--model ml/weights/yolov8x-worldv2.pt]
"""

from __future__ import annotations

import argparse
import csv
import json
import random
from pathlib import Path

import clip
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFilter
from ultralytics import YOLOWorld

# Folder name -> (prompt, final class name). Prompts are more specific than the folder names, which are
# ambiguous search terms ("switch", "transformer", "breadboard").
CLASSES: dict[str, tuple[str, str]] = {
    "battery_holder": ("battery holder for cylindrical batteries", "Battery_Holder"),
    "breadboard": ("white solderless electronics breadboard", "Breadboard"),
    "capacitor": ("electronic capacitor component", "Capacitor"),
    "connector": ("electrical wire connector", "Connector"),
    "crystal_oscillator": ("crystal oscillator electronic component", "Crystal_Oscillator"),
    "diode": ("diode electronic component", "Diode"),
    "fuse": ("electrical fuse", "Fuse"),
    "heat_sink": ("metal heat sink with fins", "Heat_Sink"),
    "ic_chip": ("integrated circuit chip", "IC_Chip"),
    "inductor_coil": ("inductor coil", "Inductor"),
    "jumper_wire": ("jumper wires with pin connectors", "Jumper_Wires"),
    "led": ("small LED light emitting diode component", "LED"),
    "microcontroller_board": ("microcontroller development board", "Microcontroller_Board"),
    "potentiometer": ("potentiometer knob component", "Potentiometer"),
    "power_supply_module": ("power supply module circuit board", "Power_Supply_Module"),
    "relay": ("relay module", "Relay"),
    "resistor": ("resistor electronic component", "Resistor"),
    "switch": ("toggle switch or push button electronic component", "Switch"),
    "transformer": ("electrical transformer", "Transformer"),
    "transistor": ("transistor electronic component", "Transistor"),
}

# Extra classes for the webcam-oriented component_dataset (folder names lower-cased).
CLASSES.update({
    "arduino_uno": ("Arduino Uno blue microcontroller board", "Arduino_Uno"),
    "arduino_nano": ("small Arduino Nano board", "Arduino_Nano"),
    "arduino_mega": ("large Arduino Mega board", "Arduino_Mega"),
    "esp32_devboard": ("ESP32 development board", "ESP32_DevBoard"),
    "esp8266_nodemcu": ("ESP8266 NodeMCU board", "ESP8266_NodeMCU"),
    "hc-sr04_ultrasonic": ("HC-SR04 ultrasonic distance sensor module with two round transducers", "HC-SR04_Ultrasonic"),
    "dht11": ("DHT11 temperature and humidity sensor", "DHT11"),
    "mpu6050": ("MPU6050 gyroscope accelerometer module", "MPU6050"),
    "pir_sensor": ("PIR motion sensor with white dome", "PIR_Sensor"),
    "ldr": ("LDR light dependent resistor photoresistor", "LDR"),
    "servo_sg90": ("SG90 micro servo motor", "Servo_SG90"),
    "dc_motor": ("small DC motor", "DC_Motor"),
    "stepper_motor": ("stepper motor", "Stepper_Motor"),
    "buzzer": ("electronic buzzer", "Buzzer"),
    "relay_module": ("relay module board", "Relay_Module"),
    "lcd_16x2": ("16x2 character LCD display", "LCD_16x2"),
    "oled_display": ("small OLED display module", "OLED_Display"),
    "l298n_driver": ("L298N motor driver board", "L298N_Driver"),
    "push_button": ("push button switch", "Push_Button"),
    "usb_cable": ("USB cable", "USB_Cable"),
})

# What scraped images often show instead of the component. Used only by the CLIP image check.
DISTRACTORS = [
    "a person", "a human face", "a hand", "a text infographic", "a circuit diagram or schematic symbol", "a chart or graph",
    "a logo", "a video game console", "furniture", "a movie poster", "a cartoon drawing", "a room lamp", "a television",
    "clothing", "a blanket", "a building", "a car",
]

IMAGE_MIN_PROB = 0.5      # CLIP probability that the image is a photo of the component (vs the distractors)
KEEP_CONF = 0.2           # minimum YOLO-World confidence for a component box
MIN_BOX_AREA = 0.01       # fraction of the image
CROP_TOP_K = 3            # the crop's class must be among CLIP's top-k component guesses
PHOTO_MIN_PROB = 0.5      # CLIP: "a photo of X" vs "a drawing/diagram/infographic of X"
CONFIDENT_IMAGE = 0.9     # CLIP image prob above which a weaker YOLO-World box / the plain-background fallback is accepted
WEAK_CONF = 0.1


def plain_background_box(image: Image.Image):
    """Box around the object on a uniform background (typical product photo), or None."""
    small = image.copy()
    small.thumbnail((256, 256))
    pixels = np.asarray(small, dtype=np.float32)
    border = np.concatenate([pixels[0], pixels[-1], pixels[:, 0], pixels[:, -1]])
    if border.std(axis=0).max() > 18:  # border isn't one plain colour
        return None
    distance = np.linalg.norm(pixels - np.median(border, axis=0), axis=2)
    mask = Image.fromarray(((distance > 40) * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(5))
    bbox = mask.getbbox()
    if not bbox:
        return None
    scale = image.width / small.width
    x1, y1, x2, y2 = (value * scale for value in bbox)
    fraction = (x2 - x1) * (y2 - y1) / (image.width * image.height)
    return [x1, y1, x2, y2] if 0.05 <= fraction <= 0.98 else None


def area(box, width, height):
    return max(0.0, (box[2] - box[0]) * (box[3] - box[1])) / (width * height)


def contact_sheet(examples, path: Path, draw_boxes: bool) -> None:
    random.seed(0)
    sample = random.sample(examples, min(48, len(examples)))
    tile = 160
    sheet = Image.new("RGB", (8 * tile, max(1, (len(sample) + 7) // 8) * (tile + 12)), "white")
    canvas = ImageDraw.Draw(sheet)
    for index, (image_path, extra) in enumerate(sample):
        image = Image.open(image_path).convert("RGB")
        if draw_boxes:
            pen = ImageDraw.Draw(image)
            for x1, y1, x2, y2 in extra:
                pen.rectangle([x1, y1, x2, y2], outline=(255, 0, 0), width=max(2, image.width // 150))
        image.thumbnail((tile - 4, tile - 4))
        x, y = (index % 8) * tile, (index // 8) * (tile + 12)
        sheet.paste(image, (x + 2, y + 12))
        canvas.text((x + 2, y), (image_path.parent.name if draw_boxes else str(extra))[:26], fill="black")
    sheet.save(path, quality=85)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--model", default="ml/weights/yolov8x-worldv2.pt")
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = YOLOWorld(args.model)
    clip_model, preprocess = clip.load("ViT-B/32", device=device, download_root=str(Path(args.model).parent / "clip"))
    images_out = args.out / "images"
    labels_out = args.out / "labels"
    images_out.mkdir(parents=True, exist_ok=True)
    labels_out.mkdir(parents=True, exist_ok=True)
    class_names = [final for _, final in CLASSES.values()]

    def encode_text(texts):
        with torch.no_grad():
            features = clip_model.encode_text(clip.tokenize(texts).to(device)).float()
        return features / features.norm(dim=-1, keepdim=True)

    def encode_image(image):
        with torch.no_grad():
            features = clip_model.encode_image(preprocess(image).unsqueeze(0).to(device)).float()
        return features / features.norm(dim=-1, keepdim=True)

    component_text = encode_text([f"a photo of a {prompt}" for prompt, _ in CLASSES.values()])
    drawing_text = encode_text([f"a drawing, diagram or illustration of a {prompt}" for prompt, _ in CLASSES.values()])
    infographic_text = encode_text([f"an advertisement or text infographic about {prompt}" for prompt, _ in CLASSES.values()])
    distractor_text = encode_text(DISTRACTORS)

    log_rows: list[dict] = []
    kept_examples: list[tuple[Path, list]] = []
    rejected_examples: list[tuple[Path, str]] = []

    for folder_index, (folder, (prompt, final_name)) in enumerate(CLASSES.items()):
        class_id = class_names.index(final_name)
        model.set_classes([prompt])
        files = sorted((args.source / "images" / folder).glob("*.jpg"))
        for path in files:
            image = Image.open(path).convert("RGB")
            image_features = encode_image(image)
            candidates = torch.cat([component_text[folder_index:folder_index + 1], distractor_text])
            probs = (100.0 * image_features @ candidates.T).softmax(dim=-1)[0].tolist()
            style = torch.cat([component_text[folder_index:folder_index + 1], drawing_text[folder_index:folder_index + 1], infographic_text[folder_index:folder_index + 1]])
            photo_prob = (100.0 * image_features @ style.T).softmax(dim=-1)[0, 0].item()
            component_prob = probs[0]
            top = max(range(len(DISTRACTORS)), key=lambda i: probs[i + 1])
            row = {"class": final_name, "folder": folder, "file": path.name, "clip_component_prob": f"{component_prob:.3f}",
                   "top_distractor": DISTRACTORS[top], "top_distractor_prob": f"{probs[top + 1]:.3f}", "box_conf": ""}

            if component_prob < IMAGE_MIN_PROB:
                row.update(decision="rejected", reason=f"image looks like {DISTRACTORS[top]} ({probs[top + 1]:.2f})")
            elif photo_prob < PHOTO_MIN_PROB:
                row.update(decision="rejected", reason=f"drawing/diagram/infographic, not a photo ({1 - photo_prob:.2f})")
            else:
                result = model.predict(str(path), conf=0.05, iou=0.5, device=0 if device == "cuda" else "cpu", verbose=False)[0]
                height, width = result.orig_shape
                min_conf = WEAK_CONF if component_prob >= CONFIDENT_IMAGE else KEEP_CONF
                good = [(xyxy, conf) for xyxy, conf in zip(result.boxes.xyxy.tolist(), result.boxes.conf.tolist())
                        if conf >= min_conf and area(xyxy, width, height) >= MIN_BOX_AREA]
                source = "yolo-world"
                if not good and component_prob >= CONFIDENT_IMAGE:
                    fallback = plain_background_box(image)
                    if fallback:
                        good, source = [(fallback, 0.0)], "plain-background"
                if not good:
                    best = max(result.boxes.conf.tolist(), default=0.0)
                    row.update(decision="rejected", reason=f"component not localised (best box {best:.2f})")
                else:
                    best_box = max(good, key=lambda item: item[1])[0]
                    crop = image.crop(tuple(int(value) for value in best_box))
                    crop_probs = (100.0 * encode_image(crop) @ component_text.T).softmax(dim=-1)[0]
                    ranking = crop_probs.argsort(descending=True).tolist()
                    row["box_conf"] = f"{max(conf for _, conf in good):.3f}" if source == "yolo-world" else "fallback"
                    if folder_index not in ranking[:CROP_TOP_K]:
                        row.update(decision="rejected", reason=f"box looks like {class_names[ranking[0]]} ({float(crop_probs[ranking[0]]):.2f})")
                    else:
                        row.update(decision="kept", reason=f"{len(good)} box(es) from {source}")
                        stem = f"{folder}_{path.stem}"
                        image.save(images_out / f"{stem}.jpg", quality=92)
                        lines = [f"{class_id} {(x1 + x2) / 2 / width:.6f} {(y1 + y2) / 2 / height:.6f} {(x2 - x1) / width:.6f} {(y2 - y1) / height:.6f}"
                                 for (x1, y1, x2, y2), _ in good]
                        (labels_out / f"{stem}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
                        kept_examples.append((path, [xyxy for xyxy, _ in good]))
            if row["decision"] == "rejected":
                rejected_examples.append((path, row["reason"]))
            log_rows.append(row)
        kept = sum(1 for row in log_rows if row["class"] == final_name and row["decision"] == "kept")
        print(f"{final_name:22s} kept {kept:4d} / {len(files)}", flush=True)

    with (args.out / "autolabel_log.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["class", "folder", "file", "decision", "reason", "clip_component_prob", "top_distractor", "top_distractor_prob", "box_conf"])
        writer.writeheader()
        writer.writerows(log_rows)
    (args.out / "classes.json").write_text(json.dumps(class_names, indent=1), encoding="utf-8")
    contact_sheet(kept_examples, args.out / "review_kept.jpg", True)
    contact_sheet(rejected_examples, args.out / "review_rejected.jpg", False)
    print(f"kept {sum(1 for row in log_rows if row['decision'] == 'kept')} / {len(log_rows)} images")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
