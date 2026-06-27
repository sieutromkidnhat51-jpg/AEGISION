import streamlit as st

def show_calibration_popup():
    """
    Hiển thị giao diện cấu hình ban đầu bằng st.dialog.
    """
    @st.dialog("Cấu hình ban đầu", width="large")
    def calibration_dialog():
        st.write("Chào mừng bạn đến với IrisAdapt Pro. Vui lòng thiết lập cấu hình ban đầu để nhận diện chính xác nhất.")
        
        eye_type = st.selectbox(
            "Chọn kiểu mắt của bạn:",
            ["Mắt thường", "Mắt híp / Mắt một mí", "Người già (Mí mắt sụp)"],
            index=0
        )
        
        st.write("Thiết lập khoảng cách ngồi an toàn (cm):")
        min_distance = st.slider("Khoảng cách tối thiểu", min_value=30, max_value=80, value=50)
        
        st.write("Ngưỡng EAR (Eye Aspect Ratio) cảnh báo chớp mắt:")
        st.info("EAR là chỉ số tính độ mở của mắt. Ngưỡng EAR thấp (VD: 0.15) phù hợp cho người mắt híp.")
        ear_threshold = st.slider("Ngưỡng nhắm mắt (EAR)", min_value=0.10, max_value=0.30, value=0.18, step=0.01)
        
        if st.button("Lưu cấu hình & Bắt đầu", use_container_width=True):
            st.session_state["calibrated"] = True
            st.session_state["config"] = {
                "eye_type": eye_type,
                "min_distance": min_distance,
                "ear_threshold": ear_threshold
            }
            st.success("Đã lưu cấu hình!")
            st.rerun()

    # Kiểm tra session state, nếu chưa cấu hình thì hiển thị dialog
    if not st.session_state.get("calibrated", False):
        calibration_dialog()

def render_sidebar_settings():
    """
    Sidebar cho phép chỉnh sửa lại cấu hình trong quá trình sử dụng.
    """
    with st.sidebar:
        st.header("Cài đặt sinh trắc học")
        if st.session_state.get("calibrated", False):
            config = st.session_state["config"]
            
            eye_types = ["Mắt thường", "Mắt híp / Mắt một mí", "Người già (Mí mắt sụp)"]
            current_idx = eye_types.index(config["eye_type"]) if config["eye_type"] in eye_types else 0
            
            new_eye_type = st.selectbox("Kiểu mắt", eye_types, index=current_idx)
            new_min_distance = st.slider("Khoảng cách tối thiểu (cm)", 30, 80, config["min_distance"])
            new_ear_threshold = st.slider("Ngưỡng EAR", 0.10, 0.30, config["ear_threshold"], 0.01)
            
            if st.button("Cập nhật"):
                st.session_state["config"] = {
                    "eye_type": new_eye_type,
                    "min_distance": new_min_distance,
                    "ear_threshold": new_ear_threshold
                }
                st.success("Đã cập nhật!")
        else:
            st.warning("Vui lòng hoàn thành cấu hình ban đầu.")
