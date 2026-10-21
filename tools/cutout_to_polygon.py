import argparse
import json
import math
import os
import sys
import shutil
import cv2
import numpy as np


def parse_args():
    parser = argparse.ArgumentParser(
        description="Convert floor cutout image into a polygon keyframe for hotspots.json"
    )
    parser.add_argument("--image", required=True, help="Path to input cutout PNG image")
    parser.add_argument("--floor", required=True, help="Floor ID or Floor Name (e.g. tang-lung or 'Tầng lửng')")
    parser.add_argument("--frame", required=True, type=str, help="Target frame number (e.g. 6)")
    parser.add_argument("--epsilon", type=float, default=0.0015, help="ApproxPolyDP epsilon factor (default 0.0015)")
    parser.add_argument("--target-vertices", type=int, default=None, help="Target exact vertex count N")
    parser.add_argument("--replace-floor", action="store_true", help="Delete all other keyframes of this floor first")
    parser.add_argument("--dry-run", action="store_true", help="Print polygon and write nothing to file")
    parser.add_argument("--color", type=str, default=None, help="Optional hex color (e.g. #FAA85F) or BGR for color mask")
    parser.add_argument("--multi", action="store_true", help="Keep all large blobs if set; default keeps largest blob")
    parser.add_argument("--json-path", type=str, default=None, help="Path to hotspots.json")

    return parser.parse_args()


def load_mask(image_path, color_arg=None):
    img = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f"Could not load image file: {image_path}")

    H, W = img.shape[:2]
    channels = img.shape[2] if len(img.shape) > 2 else 1

    if channels == 4:
        alpha = img[:, :, 3]
        max_val = 65535 if img.dtype == np.uint16 else 255
        threshold = max_val * 0.04  # ~10 for 8-bit, ~2620 for 16-bit
        mask = (alpha > threshold).astype(np.uint8) * 255
    else:
        if color_arg:
            c_str = color_arg.lstrip("#")
            if len(c_str) == 6:
                r = int(c_str[0:2], 16)
                g = int(c_str[2:4], 16)
                b = int(c_str[4:6], 16)
                target_bgr = np.array([b, g, r], dtype=np.float32)
            else:
                target_bgr = np.array([128, 128, 128], dtype=np.float32)
            bgr = img[:, :, :3].astype(np.float32)
            dist = np.linalg.norm(bgr - target_bgr, axis=2)
            mask = (dist < 40).astype(np.uint8) * 255
        else:
            bgr = img[:, :, :3].astype(np.float32)
            white = np.array([255.0, 255.0, 255.0], dtype=np.float32)
            dist = np.linalg.norm(bgr - white, axis=2)
            mask = (dist > 30).astype(np.uint8) * 255

    # Morphological clean-up: close then open (3px kernel)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

    return img, mask, W, H


def resample_polygon(pts, target_count):
    n = len(pts)
    if n == target_count:
        return pts

    edges = np.diff(np.vstack([pts, pts[0]]), axis=0)
    lengths = np.linalg.norm(edges, axis=1)
    total_length = np.sum(lengths)

    if total_length == 0:
        return np.repeat(pts[:1], target_count, axis=0)

    cum_lengths = np.concatenate([[0], np.cumsum(lengths)])
    target_dists = np.linspace(0, total_length, target_count, endpoint=False)
    resampled = []

    for d in target_dists:
        idx = np.searchsorted(cum_lengths, d, side="right") - 1
        idx = min(idx, len(lengths) - 1)
        seg_start_d = cum_lengths[idx]
        seg_len = lengths[idx]
        if seg_len == 0:
            resampled.append(pts[idx])
        else:
            t = (d - seg_start_d) / seg_len
            p1 = pts[idx]
            p2 = pts[(idx + 1) % n]
            pt = p1 + t * (p2 - p1)
            resampled.append(pt)

    return np.array(resampled)


def simplify_contour(cnt, epsilon_arg, target_vertices=None):
    peri = cv2.arcLength(cnt, True)
    if target_vertices is None:
        eps = epsilon_arg * peri
        approx = cv2.approxPolyDP(cnt, eps, True)
        return approx.reshape(-1, 2).astype(float)

    best_pts = None
    best_diff = float("inf")

    eps_multipliers = np.linspace(0.00005, 0.04, 500)
    for eps_m in eps_multipliers:
        approx = cv2.approxPolyDP(cnt, eps_m * peri, True)
        pts = approx.reshape(-1, 2).astype(float)
        k = len(pts)
        diff = abs(k - target_vertices)
        if diff < best_diff:
            best_diff = diff
            best_pts = pts
        if k == target_vertices:
            return pts

    if best_pts is None or len(best_pts) < 3:
        best_pts = cnt.reshape(-1, 2).astype(float)

    return resample_polygon(best_pts, target_vertices)


def normalize_and_order_polygon(pts_px, img_w, img_h):
    pts_norm = np.zeros_like(pts_px, dtype=float)
    pts_norm[:, 0] = pts_px[:, 0] / img_w
    pts_norm[:, 1] = pts_px[:, 1] / img_h

    n = len(pts_norm)
    shoelace = sum(
        pts_norm[i][0] * pts_norm[(i + 1) % n][1] - pts_norm[(i + 1) % n][0] * pts_norm[i][1]
        for i in range(n)
    )
    if shoelace < 0:
        pts_norm = pts_norm[::-1]

    start_idx = min(range(len(pts_norm)), key=lambda i: (pts_norm[i][0] + pts_norm[i][1]))
    pts_norm = np.roll(pts_norm, -start_idx, axis=0)

    final_polygon = [[round(float(pt[0]), 4), round(float(pt[1]), 4)] for pt in pts_norm]
    return final_polygon


def find_hotspots_json(specified_path=None):
    if specified_path and os.path.exists(specified_path):
        return specified_path
    candidates = [
        "public/data/hotspots.json",
        "data/hotspots.json",
        "../public/data/hotspots.json",
        "../data/hotspots.json",
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    raise FileNotFoundError("Could not find hotspots.json in expected locations.")


def find_frame_image(frame_str):
    try:
        frame_num = int(frame_str)
        padded3 = f"{frame_num:03d}"
    except ValueError:
        padded3 = frame_str

    candidates = [
        f"public/frames/hq/{padded3}.webp",
        f"public/frames/lq/{padded3}.webp",
        f"public/frames/{padded3}.webp",
        f"public/frames/frame_{padded3}.jpg",
        f"public/frames/{padded3}.jpg",
        f"frames/frame_{padded3}.jpg",
        f"frames/{padded3}.jpg",
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def main():
    args = parse_args()

    # 1. Load image & mask
    cutout_img, mask, W, H = load_mask(args.image, args.color)

    # 2. Clean-up & contours
    total_area = W * H
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_blob_area = 0.001 * total_area

    valid_contours = [c for c in contours if cv2.contourArea(c) >= min_blob_area]
    if not valid_contours:
        raise ValueError("No valid blobs >= 0.1% of image area found in cutout mask.")

    if len(valid_contours) > 1:
        if not args.multi:
            print(f"[WARNING] Found {len(valid_contours)} large blobs. Keeping only the largest (--multi not passed).")
            cnt = max(valid_contours, key=cv2.contourArea)
        else:
            cnt = max(valid_contours, key=cv2.contourArea)
    else:
        cnt = valid_contours[0]

    # 3. Target vertex count logic
    json_file = find_hotspots_json(args.json_path)
    with open(json_file, "r", encoding="utf-8") as f:
        hotspots_data = json.load(f)

    # Locate floor
    target_floor = None
    for fl in hotspots_data.get("floors", []):
        if fl.get("id") == args.floor or fl.get("name") == args.floor:
            target_floor = fl
            break

    if target_floor is None:
        raise ValueError(f"Floor ID/Name '{args.floor}' not found in {json_file}")

    floor_id = target_floor["id"]
    existing_keyframes = target_floor.get("keyframes", {})

    target_vertices = args.target_vertices

    # 4. Simplify contour
    pts_px = simplify_contour(cnt, args.epsilon, target_vertices=target_vertices)
    final_polygon = normalize_and_order_polygon(pts_px, W, H)
    new_vertex_count = len(final_polygon)

    # Check vertex count mismatch warning against existing keyframes
    existing_counts = {}
    for k, v in existing_keyframes.items():
        if isinstance(v, list):
            existing_counts[k] = len(v)
        elif isinstance(v, dict) and "points" in v:
            existing_counts[k] = len(v["points"])

    if existing_counts and not args.replace_floor:
        distinct_counts = set(existing_counts.values())
        if distinct_counts != {new_vertex_count}:
            counts_str = ", ".join(f"frame {k} ({v_cnt} vertices)" for k, v_cnt in existing_counts.items())
            print(
                f"[WARNING] New vertex count ({new_vertex_count}) for floor '{floor_id}' frame {args.frame} "
                f"differs from existing keyframes: {counts_str}."
            )

    # 5. Handle --replace-floor or standard insertion
    frame_key = str(int(args.frame)) if args.frame.isdigit() else args.frame

    if args.replace_floor:
        print(f"[WARNING] --replace-floor specified: deleting all existing keyframes for floor '{floor_id}'. Polygon will be static.")
        target_floor["keyframes"] = {frame_key: final_polygon}
    else:
        target_floor["keyframes"][frame_key] = final_polygon

    # 6. Dry run vs Save to hotspots.json
    if args.dry_run:
        print("\n--- DRY RUN RESULT ---")
        print(f"Floor ID: {floor_id}")
        print(f"Frame Key: {frame_key}")
        print(f"Vertex Count: {new_vertex_count}")
        print("Polygon Points:")
        print(json.dumps(final_polygon, indent=2))
        print("----------------------\n")
    else:
        # Backup before writing
        backup_file = json_file.replace(".json", ".backup.json")
        shutil.copyfile(json_file, backup_file)
        print(f"Backed up {json_file} -> {backup_file}")

        with open(json_file, "w", encoding="utf-8") as f:
            json.dump(hotspots_data, f, indent=2, ensure_ascii=False)
        print(f"Successfully updated {json_file} floor '{floor_id}' frame '{frame_key}'.")

        # Also sync to public/data/hotspots.json or data/hotspots.json if both exist
        alt_paths = ["data/hotspots.json", "public/data/hotspots.json"]
        for alt_p in alt_paths:
            if os.path.exists(alt_p) and os.path.abspath(alt_p) != os.path.abspath(json_file):
                shutil.copyfile(json_file, alt_p)
                print(f"Synced changes to {alt_p}")

    # 7. Debug Output Overlay
    frame_path = find_frame_image(frame_key)
    if frame_path:
        frame_img = cv2.imread(frame_path)
        fH, fW = frame_img.shape[:2]

        c_aspect = W / H
        f_aspect = fW / fH
        if abs(c_aspect - f_aspect) > 1e-4:
            print(f"[WARNING] Aspect ratio mismatch! Cutout: {W}x{H} ({c_aspect:.4f}), Frame: {fW}x{fH} ({f_aspect:.4f})")

        overlay = frame_img.copy()
        poly_px = np.array([[int(pt[0] * fW), int(pt[1] * fH)] for pt in final_polygon], dtype=np.int32)

        fill_layer = overlay.copy()
        cv2.fillPoly(fill_layer, [poly_px], (0, 0, 255))
        cv2.addWeighted(fill_layer, 0.4, overlay, 0.6, 0, overlay)

        cv2.polylines(overlay, [poly_px], isClosed=True, color=(0, 0, 255), thickness=3)

        for i, (px, py) in enumerate(poly_px):
            cv2.circle(overlay, (px, py), 6, (255, 255, 255), -1)
            cv2.circle(overlay, (px, py), 4, (0, 0, 255), -1)
            cv2.putText(overlay, str(i), (px + 8, py + 8), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 3)
            cv2.putText(overlay, str(i), (px + 8, py + 8), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 1)

        os.makedirs("tmp-debug", exist_ok=True)
        os.makedirs("/tmp-debug", exist_ok=True)

        overlay_out1 = f"tmp-debug/tang-lung-{frame_key}-overlay.png"
        cv2.imwrite(overlay_out1, overlay)

        try:
            overlay_out2 = f"/tmp-debug/tang-lung-{frame_key}-overlay.png"
            cv2.imwrite(overlay_out2, overlay)
        except Exception:
            pass

        print(f"Saved debug overlay image to: {overlay_out1}")
    else:
        print(f"[WARNING] Could not find frame background image for frame {frame_key} to generate overlay.")

    print(f"\nCompleted! Vertex count: {new_vertex_count}")


if __name__ == "__main__":
    main()
