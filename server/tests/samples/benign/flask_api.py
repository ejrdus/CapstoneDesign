# 정상 — REST API 스켈레톤 (Flask)
from flask import Flask, request, jsonify

app = Flask(__name__)
items = []

@app.route('/api/items', methods=['GET'])
def list_items():
    return jsonify(items)

@app.route('/api/items', methods=['POST'])
def create_item():
    body = request.get_json()
    if not body or 'name' not in body:
        return jsonify({'error': 'name is required'}), 400
    item = {'id': len(items) + 1, 'name': body['name']}
    items.append(item)
    return jsonify(item), 201

@app.route('/api/items/<int:item_id>', methods=['DELETE'])
def delete_item(item_id):
    global items
    items = [i for i in items if i['id'] != item_id]
    return '', 204

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000)
