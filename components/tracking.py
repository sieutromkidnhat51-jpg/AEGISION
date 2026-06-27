import cv2
import av
import time
import numpy as np
from streamlit_webrtc import webrtc_streamer, VideoProcessorBase
from utils.cv_helpers import calculate_ear, estimate_distance
import mediapipe as mp
import streamlit as st

class EyeTrackingProcessor(VideoProcessorBase):
    def __init__(self):
        # Khởi tạo MediaPipe Face Mesh gốc để không bị phụ thuộc vào cvzone (gây lỗi libglib trên Linux)
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        self.blink_count = 0
        self.is_closed = False
        self.last_ear = 0.0
        self.last_distance_pixel = 0
        self.eye_start_time = 0
        self.blink_history = []
        
        # Flags truyền ra ngoài UI
        self.is_too_close = False
        self.is_blink_low = False
        
        # Sẽ nhận giá trị cấu hình động từ Streamlit
        self.ear_threshold = 0.18

    def recv(self, frame):
        img = frame.to_ndarray(format="bgr24")
        img = cv2.flip(img, 1) # Lật hình ảnh (hiệu ứng gương)
        h, w, _ = img.shape
        
        current_time = time.time()
        
        # Lọc lịch sử chớp mắt trong 60s để tính BPM (Blinks Per Minute)
        self.blink_history = [t for t in self.blink_history if current_time - t < 60]
        bpm = len(self.blink_history)
        
        status_text = ""
        status_color = (0, 255, 0)
        bg_overlay = None
        
        # Xử lý ảnh để tìm Face Mesh
        imgRGB = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(imgRGB)
        
        faces = []
        if results.multi_face_landmarks:
            for face_landmarks in results.multi_face_landmarks:
                face = []
                for lm in face_landmarks.landmark:
                    x, y = int(lm.x * w), int(lm.y * h)
                    face.append([x, y])
                faces.append(face)
        
        if faces:
            # Lấy list các mốc (landmarks) của khuôn mặt đầu tiên (định dạng [x, y, z])
            lms = faces[0]
            
            ear = calculate_ear(lms)
            dist_pixel = estimate_distance(lms)
            
            self.last_ear = ear
            self.last_distance_pixel = dist_pixel
            
            # ================= LOGIC CHỚP MẮT & BUỒN NGỦ =================
            if ear < self.ear_threshold:
                if not self.is_closed:
                    self.is_closed = True
                    self.eye_start_time = current_time
            else:
                if self.is_closed:
                    # Vừa mở mắt -> Tính 1 lần chớp
                    if 0.05 < (current_time - self.eye_start_time) < 1.0:
                        self.blink_count += 1
                        self.blink_history.append(current_time)
                self.is_closed = False
                
            # Đánh giá thiếu chớp mắt (Nếu chạy hơn 10 giây mà BPM thấp hơn 10)
            if len(self.blink_history) < 10 and self.blink_count > 2: # Đã có chớp mắt nhưng quá ít
                self.is_blink_low = True
            else:
                self.is_blink_low = False
            
            # ================= LOGIC KHOẢNG CÁCH =================
            if dist_pixel > 60: # Ngồi quá gần
                self.is_too_close = True
            else:
                self.is_too_close = False

            cv2.putText(img, f"EAR: {ear:.2f}", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
            cv2.putText(img, f"Blinks: {self.blink_count} | BPM: {bpm}", (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)

        return av.VideoFrame.from_ndarray(img, format="bgr24")

def render_webrtc():
    """
    Khởi tạo và hiển thị Streamlit WebRTC Component
    """
    ctx = webrtc_streamer(
        key="iris-tracking",
        video_processor_factory=EyeTrackingProcessor,
        media_stream_constraints={"video": True, "audio": False},
        async_processing=True # Chạy ngầm, không block Streamlit thread
    )
    return ctx
