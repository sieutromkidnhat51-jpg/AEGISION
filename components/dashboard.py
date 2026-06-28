import streamlit as st
import pandas as pd
import altair as alt
import time

from utils.supabase_client import supabase
from components.tracking import render_webrtc

def render_dashboard():
    """
    Render giao diện Dashboard chia làm 2 cột:
    Cột 1: Video Stream Camera
    Cột 2: Real-time Charts
    """
    col1, col2 = st.columns([1, 1])

    with col1:
        st.subheader("📷 Theo dõi Camera (Real-time)")
        ctx = render_webrtc()

    with col2:
        st.subheader("📊 Live Chart: Chỉ số mắt")
        effect_placeholder = st.empty() # Placeholder ẩn để chèn CSS Blur
        audio_placeholder = st.empty()  # Placeholder để chèn Audio
        chart_placeholder = st.empty()
        
        # Nếu WebRTC đang chạy, lấy dữ liệu từ video processor để vẽ chart
        if ctx.state.playing:
            run_live_chart(chart_placeholder, effect_placeholder, audio_placeholder, ctx)
        else:
            st.info("Vui lòng bấm START Camera để hiển thị biểu đồ Real-time.")
            
        st.markdown("---")
        if st.button("💾 Lưu dữ liệu Phiên làm việc (Lên AI Agent)", type="primary", use_container_width=True):
            save_session_log()

def save_session_log():
    if "session_stats" in st.session_state:
        stats = st.session_state["session_stats"]
        try:
            # Lưu dữ liệu lên bảng user_logs của Supabase
            supabase.table("user_logs").insert({
                "user_id": "anonymous",
                "avg_ear": float(stats["avg_ear"]),
                "avg_distance": float(stats["avg_distance"])
            }).execute()
            st.success("✅ Đã lưu dữ liệu phiên làm việc lên hệ thống AI thành công!")
        except Exception as e:
            st.error(f"Lỗi khi lưu log (Có thể bảng user_logs chưa được tạo trên Supabase): {str(e)}")
    else:
        st.warning("⚠️ Chưa có dữ liệu để lưu (Hãy bật Camera và theo dõi ít nhất 5 giây).")

def run_live_chart(placeholder, effect_placeholder, audio_placeholder, ctx):
    """
    Hàm vẽ biểu đồ thời gian thực sử dụng dữ liệu từ ctx.video_processor.
    """
    # Khởi tạo DataFrame rỗng
    data = pd.DataFrame(columns=["time", "ear", "distance"])
    current_blur = 0 # Trạng thái mờ mặc định
    
    # State cho Timer và Audio
    last_blink_warning = time.time()
    last_20_20_20 = time.time()
    
    # URL Âm thanh
    WATER_DROP_URL = "https://actions.google.com/sounds/v1/water/water_drop.ogg"
    CHIME_URL = "https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg"
    
    # Vòng lặp lấy dữ liệu liên tục chừng nào Camera còn bật
    while ctx.state.playing:
        if ctx.video_processor:
            # Lấy dữ liệu mới nhất từ background thread
            current_time = pd.Timestamp.now()
            ear = ctx.video_processor.last_ear
            dist_pixel = ctx.video_processor.last_distance_pixel
            
            # Cập nhật threshold từ session_state sang video processor
            if "config" in st.session_state:
                ctx.video_processor.ear_threshold = st.session_state["config"]["ear_threshold"]

            new_row = pd.DataFrame({
                "time": [current_time],
                "ear": [ear],
                "distance": [dist_pixel]
            })
            
            # Gộp và lưu trữ vào state
            if not new_row.empty:
                data = pd.concat([data, new_row], ignore_index=True)
                
                # ======= 1. TÍNH NĂNG MỜ MÀN HÌNH (BLUR FILTER) =======
                # Kiểm tra cờ is_too_close từ video processor
                target_blur = 8 if ctx.video_processor.is_too_close else 0
                        
                if target_blur != current_blur:
                    current_blur = target_blur
                    # Bơm CSS bằng markdown để làm mờ toàn bộ HTML mượt mà
                    effect_placeholder.markdown(
                        f'<style>html {{ filter: blur({current_blur}px); transition: filter 0.5s ease; }}</style>', 
                        unsafe_allow_html=True
                    )
                # ====================================================

                # ======= 2. ÂM THANH AMBIENT (CHỚP MẮT CHẬM) =======
                current_time_sec = time.time()
                if ctx.video_processor.is_blink_low and current_time_sec - last_blink_warning > 15:
                    last_blink_warning = current_time_sec
                    audio_placeholder.markdown(
                        f'<audio autoplay src="{WATER_DROP_URL}"></audio>', 
                        unsafe_allow_html=True
                    )
                # ====================================================
                
                # ======= 3. QUY TẮC 20-20-20 (TEST 20 GIÂY) =======
                # Sửa số 20 bên dưới thành 1200 (20 * 60) khi triển khai thực tế
                if current_time_sec - last_20_20_20 > 20: 
                    last_20_20_20 = current_time_sec
                    audio_placeholder.markdown(
                        f'<audio autoplay src="{CHIME_URL}"></audio>', 
                        unsafe_allow_html=True
                    )
                    st.toast("⏳ Đã làm việc được 20 phút (test 20s)! Bây giờ hãy nhìn xa 20 feet trong 20s để nghỉ ngơi nhé.", icon="⚠️")
                # ====================================================

                # Cập nhật thống kê phiên để lưu log
                st.session_state["session_stats"] = {
                    "avg_ear": data["ear"].mean(),
                    "avg_distance": data["distance"].mean()
                }
                
                # Chỉ giữ 30 điểm cho biểu đồ
                data = data.tail(30)
            
            # Vẽ biểu đồ EAR (Area Chart)
            ear_line = alt.Chart(data).mark_line(color='#20C997', strokeWidth=3).encode(
                x=alt.X('time:T', title='', axis=alt.Axis(format='%H:%M:%S', grid=False, domainOpacity=0)),
                y=alt.Y('ear:Q', title='Chỉ số EAR', scale=alt.Scale(domain=[0.10, 0.40]), axis=alt.Axis(grid=True, gridColor='#2A303C'))
            )
            ear_area = alt.Chart(data).mark_area(color='#20C997', opacity=0.2).encode(
                x=alt.X('time:T'),
                y=alt.Y('ear:Q')
            )
            ear_chart = alt.layer(ear_area, ear_line).properties(height=200)
            
            # Vẽ biểu đồ Khoảng cách (Area Chart)
            dist_line = alt.Chart(data).mark_line(color='#3399FF', strokeWidth=3).encode(
                x=alt.X('time:T', title='', axis=alt.Axis(format='%H:%M:%S', grid=False, domainOpacity=0)),
                y=alt.Y('distance:Q', title='Khoảng cách (Pixel)', scale=alt.Scale(domain=[40, 150]), axis=alt.Axis(grid=True, gridColor='#2A303C'))
            )
            dist_area = alt.Chart(data).mark_area(color='#3399FF', opacity=0.2).encode(
                x=alt.X('time:T'),
                y=alt.Y('distance:Q')
            )
            dist_chart = alt.layer(dist_area, dist_line).properties(height=200)
            
            # Render chart lên UI
            with placeholder.container():
                st.altair_chart(ear_chart, use_container_width=True)
                st.altair_chart(dist_chart, use_container_width=True)
                
        time.sleep(0.5) # Cập nhật chart mỗi 0.5 giây để tránh quá tải



