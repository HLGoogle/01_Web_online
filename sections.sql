CREATE TABLE sections (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    type ENUM('类型1', '类型2', '类型3') NOT NULL
);

-- 插入示例数据
INSERT INTO sections (title, content, type) VALUES
('部分 1'， '<div style="text-align: center;">
    <h2>这是部分 1 的详细内容。</h2>
    <p>文字描述区，用于介绍该部分的内容文字。</p>
    <div style="display: flex; justify-content: center; gap: 20px;">
        <a href="#">www.baidu.com</a>
        <a href="#">链接二</a>
        <a href="#">链接三</a>
    </div>
</div>'， '类型1');

INSERT INTO sections (title, content, type) VALUES
('部分 2'， '<div style="text-align: center;">
    <h2>这是部分 2 的详细内容。</h2>
    <p>文字描述区，用于介绍该部分的内容文字。</p>
    <div style="display: flex; justify-content: center; gap: 20px;">
        <a href="#">链接一</a>
        <a href="#">链接二</a>
        <a href="#">链接三</a>
    </div>
</div>'， '类型1');

INSERT INTO sections (title, content, type) VALUES
('部分 3'， '<div style="text-align: center;">
    <h2>这是部分 3 的详细内容。</h2>
    <p>文字描述区，用于介绍该部分的内容文字。</p>
    <div style="display: flex; justify-content: center; gap: 20px;">
        <a href="#">链接一</a>
        <a href="#">链接二</a>
        <a href="#">链接三</a>
    </div>
</div>', '类型1');

INSERT INTO sections (title, content, type) VALUES
('部分 4', '<div style="text-align: center;">
    <h2>这是部分 4 的详细内容。</h2>
    <p>文字描述区，用于介绍该部分的内容文字。</p>
    <div style="display: flex; justify-content: center; gap: 20px;">
        <a href="#">链接一</a>
        <a href="#">链接二</a>
        <a href="#">链接三</a>
    </div>
</div>', '类型1');

INSERT INTO sections (title, content, type) VALUES
('部分 5', '<div style="text-align: center;">
    <h2>这是部分 5 的详细内容。</h2>
    <p>文字描述区，用于介绍该部分的内容文字。</p>
    <div style="display: flex; justify-content: center; gap: 20px;">
        <a href="#">链接一</a>
        <a href="#">链接二</a>
        <a href="#">链接三</a>
    </div>
</div>', '类型2');

INSERT INTO sections (title, content, type) VALUES
('部分 6', '<div style="text-align: center;">
    <h2>这是部分 6 的详细内容。</h2>
    <p>文字描述区，用于介绍该部分的内容文字。</p>
    <div style="display: flex; justify-content: center; gap: 20px;">
        <a href="#">链接一</a>
        <a href="#">链接二</a>
        <a href="#">链接三</a>
    </div>
</div>', '类型2');

INSERT INTO sections (title, content, type) VALUES
('部分 7', '<div style="text-align: center;">
    <h2>这是部分 7 的详细内容。</h2>
    <p>文字描述区，用于介绍该部分的内容文字。</p>
    <div style="display: flex; justify-content: center; gap: 20px;">
        <a href="#">链接一</a>
        <a href="#">链接二</a>
        <a href="#">链接三</a>
    </div>
</div>', '类型3');

INSERT INTO sections (title, content, type) VALUES
('部分 8', '<div style="text-align: center;">
    <h2>这是部分 8 的详细内容。</h2>
    <p>文字描述区，用于介绍该部分的内容文字。</p>
    <div style="display: flex; justify-content: center; gap: 20px;">
        <a href="#">链接一</a>
        <a href="#">链接二</a>
        <a href="#">链接三</a>
    </div>
</div>', '类型3');

INSERT INTO sections (title, content, type) VALUES
('部分 9', '<div style="text-align: center;">
    <h2>这是部分 9 的详细内容。</h2>
    <p>文字描述区，用于介绍该部分的内容文字。</p>
    <div style="display: flex; justify-content: center; gap: 20px;">
        <a href="#">链接一</a>
        <a href="#">链接二</a>
        <a href="#">链接三</a>
    </div>
</div>', '类型3');

INSERT INTO sections (title, content, type) VALUES ('11', '11', '类型1');
INSERT INTO sections (title, content, type) VALUES ('111', '分分分', '类型1');
INSERT INTO sections (title, content, type) VALUES ('11', '222', '类型1');
INSERT INTO sections (title, content, type) VALUES ('111 ', '对对对', '类型2');
