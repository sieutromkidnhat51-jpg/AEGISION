import numpy as np

def calculate_ear(lm_list, eye_type="Mắt thường"):
    """
    Tính toán chỉ số EAR cho 2 mắt dựa trên MediaPipe Face Mesh Landmarks.
    """
    try:
        # Mắt trái: Trích xuất tọa độ các điểm mốc
        p_l = [lm_list[i] for i in [33, 160, 158, 133, 153, 144]]
        v1_l = np.linalg.norm(np.array(p_l[1][:2]) - np.array(p_l[5][:2]))
        v2_l = np.linalg.norm(np.array(p_l[2][:2]) - np.array(p_l[4][:2]))
        h_l = np.linalg.norm(np.array(p_l[0][:2]) - np.array(p_l[3][:2]))
        ear_left = (v1_l + v2_l) / (2.0 * h_l)

        # Mắt phải: Trích xuất tọa độ
        p_r = [lm_list[i] for i in [362, 385, 387, 263, 373, 380]]
        v1_r = np.linalg.norm(np.array(p_r[1][:2]) - np.array(p_r[5][:2]))
        v2_r = np.linalg.norm(np.array(p_r[2][:2]) - np.array(p_r[4][:2]))
        h_r = np.linalg.norm(np.array(p_r[0][:2]) - np.array(p_r[3][:2]))
        ear_right = (v1_r + v2_r) / (2.0 * h_r)

        return max(ear_left, ear_right)
    except Exception:
        return 0

def estimate_distance(lm_list):
    """
    Ước lượng khoảng cách dựa trên khoảng cách giữa 2 điểm mắt xa nhất (33 và 263).
    Khoảng cách (cm) tỷ lệ nghịch với số pixel.
    """
    try:
        dist_pixel = int(np.linalg.norm(np.array(lm_list[33][:2]) - np.array(lm_list[263][:2])))
        # Cần mapping chuẩn từ pixel -> cm. Giả sử 75px là ~70cm, 115px là ~30cm.
        # Chúng ta dùng ước lượng tuyến tính đơn giản hoặc trả về pixel trước.
        return dist_pixel
    except Exception:
        return 0
