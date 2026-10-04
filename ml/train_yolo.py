import csv
import gc
import json
import time
from pathlib import Path

import yaml
from ultralytics import YOLO


ROOT = Path(__file__).resolve().parent.parent
DATA_CONFIG = ROOT / "ml" / "dataset" / "yolo" / "data.yaml"
OUTPUT_ROOT = ROOT / "ml" / "models"
IMAGE_SIZE = 640
EPOCHS = 50
SEED = 42


def image_count(directory):
    extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}
    return sum(path.suffix.lower() in extensions for path in directory.rglob("*"))


def load_data_config():
    dataset_root = DATA_CONFIG.parent.resolve()
    config = yaml.safe_load(DATA_CONFIG.read_text(encoding="utf-8"))
    config["path"] = str(dataset_root)
    for split in ("train", "val", "test"):
        split_paths = config[split]
        if isinstance(split_paths, list):
            config[split] = [str((dataset_root / path).resolve()) for path in split_paths]
        else:
            config[split] = str((dataset_root / split_paths).resolve())
    return config


def next_run_destination(batch):
    base_name = f"yolo11n_cpu_seed{SEED}_batch{batch}"
    run_name = base_name
    suffix = 2
    while (OUTPUT_ROOT / run_name).exists():
        run_name = f"{base_name}-{suffix}"
        suffix += 1
    return run_name, OUTPUT_ROOT / run_name


def values(value):
    if value is None:
        return []
    if hasattr(value, "tolist"):
        return value.tolist()
    return list(value)


def evaluate(best_path, split, names, run_dir, data_config_path):
    result = YOLO(str(best_path)).val(
        data=str(data_config_path),
        split=split,
        imgsz=IMAGE_SIZE,
        batch=8,
        device="cpu",
        workers=0,
        plots=True,
        project=str(run_dir / "evaluation"),
        name=split,
        exist_ok=True,
    )
    box = result.box
    class_indices = values(getattr(box, "ap_class_index", []))
    precisions = values(getattr(box, "p", []))
    recalls = values(getattr(box, "r", []))
    ap50 = values(getattr(box, "ap50", []))
    ap = values(getattr(box, "ap", []))
    per_class = {}
    for position, class_index in enumerate(class_indices):
        class_index = int(class_index)
        per_class[names[class_index]] = {
            "precision": float(precisions[position]) if position < len(precisions) else None,
            "recall": float(recalls[position]) if position < len(recalls) else None,
            "mAP50": float(ap50[position]) if position < len(ap50) else None,
            "mAP50-95": float(ap[position]) if position < len(ap) else None,
        }

    confusion = getattr(result, "confusion_matrix", None)
    matrix = getattr(confusion, "matrix", None)
    normalized_matrix = getattr(confusion, "normalized_matrix", None)
    metrics = {
        "split": split,
        "precision": float(box.mp),
        "recall": float(box.mr),
        "mAP50": float(box.map50),
        "mAP50-95": float(box.map),
        "per_class": per_class,
        "confusion_matrix": matrix.tolist() if hasattr(matrix, "tolist") else matrix,
        "normalized_confusion_matrix": (
            normalized_matrix.tolist()
            if hasattr(normalized_matrix, "tolist")
            else normalized_matrix
        ),
        "artifacts_directory": str(run_dir / "evaluation" / split),
    }
    metrics_path = run_dir / "evaluation" / split / "metrics.json"
    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    return metrics


def main():
    config = load_data_config()
    names_data = config["names"]
    names = {
        int(index): name for index, name in names_data.items()
    } if isinstance(names_data, dict) else dict(enumerate(names_data))
    for split in ("train", "val", "test"):
        folder = Path(config[split])
        count = image_count(folder)
        if not folder.is_dir() or count == 0:
            raise FileNotFoundError(f"Dataset {split} split is missing or empty: {folder}")
        print(f"{split}: {count} images ({folder})", flush=True)
    print(f"Classes: {names}", flush=True)

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    batch_sizes = (8, 4, 2, 1)
    model = None
    run_dir = None
    data_config_path = None
    for batch in batch_sizes:
        run_name, run_dir = next_run_destination(batch)
        run_dir.mkdir(parents=True)
        data_config_path = run_dir / "data_absolute.yaml"
        data_config_path.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
        model = YOLO("yolo11n.pt")
        try:
            model.train(
                data=str(data_config_path),
                imgsz=IMAGE_SIZE,
                epochs=EPOCHS,
                batch=batch,
                device="cpu",
                pretrained=True,
                patience=10,
                seed=SEED,
                deterministic=True,
                workers=0,
                project=str(OUTPUT_ROOT),
                name=run_name,
                exist_ok=True,
                plots=True,
                save=True,
                amp=False,
            )
            run_dir = Path(model.trainer.save_dir)
            break
        except (MemoryError, RuntimeError) as error:
            message = str(error).lower()
            is_memory_error = any(
                phrase in message
                for phrase in ("out of memory", "not enough memory", "defaultcpuallocator")
            )
            if not is_memory_error or batch == batch_sizes[-1]:
                raise
            print(f"Batch {batch} exhausted memory; retrying at batch {batch // 2}.", flush=True)
            del model
            gc.collect()

    if run_dir is None:
        raise RuntimeError("Training did not produce an output directory.")
    best_path = Path(model.trainer.best)
    if not best_path.is_file():
        raise FileNotFoundError(f"Best checkpoint was not saved: {best_path}")

    results_csv = run_dir / "results.csv"
    with results_csv.open(newline="", encoding="utf-8-sig") as results_file:
        rows = list(csv.DictReader(results_file))
    metric_column = "metrics/mAP50-95(B)"
    best_row = max(rows, key=lambda row: float(row[metric_column].strip()))
    best_epoch = int(float(best_row["epoch"].strip()))
    training_seconds = time.perf_counter() - started

    evaluation = {
        split: evaluate(best_path, split, names, run_dir, data_config_path)
        for split in ("val", "test")
    }
    summary = {
        "model": "yolo11n.pt",
        "best_model": str(best_path),
        "dataset": str(DATA_CONFIG),
        "image_size": IMAGE_SIZE,
        "requested_epochs": EPOCHS,
        "completed_epochs": len(rows),
        "best_epoch": best_epoch,
        "batch_size": int(model.trainer.args.batch),
        "device": "cpu",
        "seed": SEED,
        "training_time_seconds": round(training_seconds, 2),
        "results_csv": str(results_csv),
        "effective_dataset_config": str(data_config_path),
        "evaluation": evaluation,
    }
    summary_path = run_dir / "training_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == "__main__":
    main()