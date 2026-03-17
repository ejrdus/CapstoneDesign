# 정상 코드 샘플 - 파일 정리
import os
import shutil

EXTENSIONS = {
    'images': ['.jpg', '.png', '.gif'],
    'documents': ['.pdf', '.docx', '.txt'],
    'videos': ['.mp4', '.avi', '.mov'],
}

def organize_files(directory):
    for filename in os.listdir(directory):
        filepath = os.path.join(directory, filename)
        if os.path.isfile(filepath):
            ext = os.path.splitext(filename)[1].lower()
            for folder, extensions in EXTENSIONS.items():
                if ext in extensions:
                    dest = os.path.join(directory, folder)
                    os.makedirs(dest, exist_ok=True)
                    shutil.move(filepath, os.path.join(dest, filename))
                    break

if __name__ == '__main__':
    organize_files(os.path.expanduser('~/Downloads'))
