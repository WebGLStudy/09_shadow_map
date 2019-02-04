(function(){
    'use strict';

    // 変数
    var gl, canvas;
    var prg_sm, prg_scene, prg_debug;
    
    var vao_floor, vao_box, vao_debug_plane;
    var wMatrixFloor, wMatrixBox;

    window.addEventListener('load', function(){
        ////////////////////////////
        // 初期化
        ////////////////////////////
        
        // canvas の初期化
        canvas = document.getElementById('canvas');
        canvas.width = 512;
        canvas.height = 512;

        // WeebGLの初期化(WebGL 2.0)
        gl = canvas.getContext('webgl2');
        
        // 浮動小数点数レンダーターゲットの確認
        var ext;
        ext = gl.getExtension('EXT_color_buffer_float');
        if(ext == null){
            alert('float texture not supported');
            return;
        }
        
        ////////////////////////////
        // プログラムオブジェクトの初期化
        
        // シャドウマップ生成用シェーダ
        var vsSourceSM = [
            '#version 300 es',
            'in vec3 position;',
            'in vec3 color;',
            
            'uniform mat4 mwMatrix;',
            'uniform mat4 mpvMatrix;',
            
            'out vec2 vPosition;',

            'void main(void) {',
                'gl_Position = mpvMatrix * mwMatrix * vec4(position, 1.0);',
                'vPosition = vec2(gl_Position.z, gl_Position.w);',
            '}'
        ].join('\n');

        var fsSourceSM = [
            '#version 300 es',
            'precision highp float;',
            
            'in vec2 vPosition;',
            
            'out float outDepth;',

            'void main(void) {',
                'outDepth = vPosition.x / vPosition.y;',
            '}'
        ].join('\n');

        // シーン描画用シェーダ
        var vsSourceScene = [
            '#version 300 es',
            'in vec3 position;',
            'in vec3 color;',
            
            'uniform mat4 mwMatrix;',
            'uniform mat4 mpvMatrix;',
            'uniform mat4 mpvMatrixSM;',
            
            'out vec4 vDepth;',
            'out vec4 vColor;',

            'void main(void) {',
                'vec4 wPos = mwMatrix * vec4(position, 1.0);',
                'gl_Position = mpvMatrix * wPos;',

                'vDepth = mpvMatrixSM * wPos;',
                'vColor = vec4(color, 1.0);',
            '}'
        ].join('\n');

        var fsSourceScene = [
            '#version 300 es',
            'precision highp float;',
            
            'in vec4 vDepth;',
            'in vec4 vColor;',
            
            'uniform sampler2D image;',

            'out vec4 outColor;',

            'void main(void) {',
                'float SM = texture(image, vDepth.xy/vDepth.w).x;',// シャドウマップのカメラ深度
                'float depth = vDepth.z / vDepth.w;',// 描画オブジェクトのカメラ深度
                
                'float shadow = 1.0;',
                'if(SM < depth - 0.001){',
                    'shadow = 0.3;',
                '}',

                'outColor = vec4(shadow * vColor.rgb, 1.0);',
            '}'
        ].join('\n');

        // デバッグ用シェーダ
        var vsSourceDebug = [
            '#version 300 es',
            'in vec3 position;',
            'in vec2 uv;',
            
            'out vec2 vTexCoord;',

            'void main(void) {',
                'gl_Position = vec4(position, 1.0);',
                'vTexCoord = uv;',
            '}'
        ].join('\n');

        var fsSourceDebug = [
            '#version 300 es',
            'precision highp float;',
            
            'in vec2 vTexCoord;',
            
            'uniform sampler2D image;',

            'out vec4 outColor;',

            'void main(void) {',
                'float depth = texture(image, vTexCoord).r;',
                'outColor = vec4(depth, depth, depth, 1.0);',
            '}'
        ].join('\n');

        // シェーダ「プログラム」の初期化
        prg_sm = create_program(vsSourceSM, fsSourceSM, ['mwMatrix', 'mpvMatrix']);
        prg_scene = create_program(vsSourceScene, fsSourceScene, ['mwMatrix', 'mpvMatrix', 'mpvMatrixSM']);
        prg_debug = create_program(vsSourceDebug, fsSourceDebug, ['mwMatrix']);


        ////////////////////////////
        // フレームバッファオブジェクトの取得
        var fShadowMapWidth  = 2048;
        var fShadowMapHeight = 2048;
        var ShadowMap = create_framebuffer(fShadowMapWidth, fShadowMapHeight);


        ////////////////////////////
        // モデルの構築
        vao_floor = createFloor(gl, prg_scene.prg);// 平面
        vao_box = createBox(gl, prg_scene.prg);// 半透明群
        vao_debug_plane = createDebugPlane(gl, prg_debug.prg);// デバッグ用
        
        ////////////////////////////
        // 各種行列の事前計算
        var mat = new matIV();// 行列のシステムのオブジェクト

        // シーンの射影行列の生成
        var pMatrix   = mat.identity(mat.create());// 射影行列
        mat.perspective(40, canvas.width / canvas.height, 0.01, 20.0, pMatrix);// 射影行列の生成

        // シャドウマップ用の行列の生成

        // ビュー行列
        var camera_pos_SM = [-10.0, 10.0, -10.0];
        var look_at_SM = [0.0, 0.0, 0.0];
        var up_SM = [0.0, 1.0, 0.0];
        var vMatrixSM = mat.create();
        mat.lookAt(camera_pos_SM, look_at_SM, up_SM, vMatrixSM);
        // 射影行列
        var pMatrixSM   = mat.identity(mat.create());
        mat.perspective(45, fShadowMapWidth / fShadowMapHeight, 10.0, 25.0, pMatrixSM);
        // ビュー射影行列の生成
        var pvMatrixSM = mat.create();
        mat.multiply (pMatrixSM, vMatrixSM, pvMatrixSM);
        
        // 正規化クリップ空間[(-1,-1)->(+1,+1)]から正規化スクリーン空間[(0,0)->(1,1)]に変換
        var sMatrix = mat.create();
        sMatrix[0]  = 0.5; sMatrix[1]  = 0.0; sMatrix[2]  = 0.0; sMatrix[3]  = 0.0;
        sMatrix[4]  = 0.0; sMatrix[5]  = 0.5; sMatrix[6]  = 0.0; sMatrix[7]  = 0.0;
        sMatrix[8]  = 0.0; sMatrix[9]  = 0.0; sMatrix[10] = 1.0; sMatrix[11] = 0.0;
        sMatrix[12] = 0.5; sMatrix[13] = 0.5; sMatrix[14] = 0.0; sMatrix[15] = 1.0;

        // シーンの情報の設定
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);

        ////////////////////////////
        // フレームの更新
        ////////////////////////////
        var lastTime = null;
        var angle = 0.0;// 物体を動かす角度

        window.requestAnimationFrame(update);
        
        function update(timestamp){
            ////////////////////////////
            // 動かす
            ////////////////////////////
            // 更新間隔の取得
            var elapsedTime = lastTime ? timestamp - lastTime : 0;
            lastTime = timestamp;

            // カメラを回すパラメータ
            angle += 0.0001 * elapsedTime;
            if(1.0 < angle) angle -= 1.0;

            // ワールド行列の生成
            wMatrixFloor = mat.identity(mat.create());
            wMatrixBox   = mat.identity(mat.create());
            mat.rotate(wMatrixBox, 2.0 * Math.PI* angle, [0.0, 1.0, 0.0], wMatrixBox);

            // ビュー行列の生成
            var camera_pos = [0.0, 3.0, -10.0];
            var look_at = [0.0, 0.0, 0.0];
            var up = [0.0, 1.0, 0.0];
            var vMatrix = mat.create();
            mat.lookAt(camera_pos, look_at, up, vMatrix);

            // ビュー射影行列の生成
            var pvMatrix = mat.create();
            mat.multiply (pMatrix, vMatrix, pvMatrix);
            
            ////////////////////////////
            // 描画
            ////////////////////////////
            
            ////////////////////////////
            // シャドウマップの作成
            gl.bindFramebuffer(gl.FRAMEBUFFER, ShadowMap.f);
            gl.viewport(0.0, 0.0, fShadowMapWidth, fShadowMapHeight);
            
            // 画面クリア
            gl.clearColor(1.0, 0.0, 0.0, 1.0);
            gl.clearDepth(1.0);// 初期設定する深度値(一番奥の深度)
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            
            // オブジェクト描画
            gl.useProgram(prg_sm.prg);
            draw_scene(prg_sm, pvMatrixSM);

            ////////////////////////////
            // シーンの描画
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0.0, 0.0, canvas.width, canvas.height);

            // 画面クリア
            gl.clearColor(1.0, 0.0, 0.0, 1.0);
            gl.clearDepth(1.0);// 初期設定する深度値(一番奥の深度)
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            
            // オブジェクト描画
            gl.useProgram(prg_scene.prg);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, ShadowMap.t);
            var tmpMatrix = mat.create();
            mat.multiply(sMatrix, pvMatrixSM, tmpMatrix);
            gl.uniformMatrix4fv(prg_scene.loc[2], false, tmpMatrix);
            draw_scene(prg_scene, pvMatrix);
            
            ////////////////////////////
            // デバッグ描画
            gl.useProgram(prg_debug.prg);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, ShadowMap.t);

            gl.bindVertexArray(vao_debug_plane);
            gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_BYTE, 0);

            ////////////////////////////
            // 次のフレームへの処理
            ////////////////////////////
            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.useProgram(null);
            gl.flush();
            window.requestAnimationFrame(update);
        }
        
    }, false);

    // モデル描画
    function draw_scene(program, pvMatrix)
    {
        gl.uniformMatrix4fv(program.loc[1], false, pvMatrix);
        
        // 箱
        gl.uniformMatrix4fv(program.loc[0], false, wMatrixBox);
        gl.bindVertexArray(vao_box);
        gl.drawElements(gl.TRIANGLES, 6*6, gl.UNSIGNED_BYTE, 0);

        // 床
        gl.uniformMatrix4fv(program.loc[0], false, wMatrixFloor);
        gl.bindVertexArray(vao_floor);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_BYTE, 0);
    }

    // シェーダの読み込み
    function load_shader(src, type)
    {
        var shader = gl.createShader(type);
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        if(!gl.getShaderParameter(shader, gl.COMPILE_STATUS)){
            alert(gl.getShaderInfoLog(shader));
        }
        return shader;
    }

    // プログラムオブジェクトの生成
    function create_program(vsSource, fsSource, uniform_names)
    {
        var prg = gl.createProgram();
        gl.attachShader(prg, load_shader(vsSource, gl.VERTEX_SHADER));
        gl.attachShader(prg, load_shader(fsSource, gl.FRAGMENT_SHADER));
        gl.linkProgram(prg);
        if(!gl.getProgramParameter(prg, gl.LINK_STATUS)){
            alert(gl.getProgramInfoLog(prg));
        }

        var uniLocations = [];
        uniform_names.forEach(function(value){
            uniLocations.push(gl.getUniformLocation(prg, value));
        });
        
        return {prg : prg, loc : uniLocations};
    }

    // フレームバッファの生成(1成分float, float深度バッファ付き)
    function create_framebuffer(width, height){
        // フレームバッファ
        var frameBuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
        
        // 深度バッファ
        var depthBuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT32F, width, height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
        
        // 書き出し用テクスチャ
        var texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST );// floatだとバイリニア不可
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        
        // 各種オブジェクトを解除
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        
        // フレームバッファとテクスチャを返す
        return {f : frameBuffer, t : texture};
    }
    
    // 床モデルの生成
    function createFloor(gl, program) {
        var vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        // 頂点バッファ
        var vertex_data = new Float32Array([
         // x     y     z      R    G    B 
          +5.0, -1.0, +5.0,   0.5, 0.5, 0.5,
          +5.0, -1.0, -5.0,   0.5, 0.5, 0.5,
          -5.0, -1.0, +5.0,   0.5, 0.5, 0.5,
          -5.0, -1.0, -5.0,   0.5, 0.5, 0.5,
        ]);

        const vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertex_data, gl.STATIC_DRAW);

        var posAttr = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(posAttr);
        gl.vertexAttribPointer(posAttr, 3, gl.FLOAT, false, 4*6, 0);

        var colAttr = gl.getAttribLocation(program, 'color');
        gl.enableVertexAttribArray(colAttr);
        gl.vertexAttribPointer(colAttr, 3, gl.FLOAT, false, 4*6, 4*3);

        // インデックスバッファ
        var index_data = new Uint8Array([
          0,  1,  2,   3,  2,  1,
        ]);
        var indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index_data, gl.STATIC_DRAW);

        gl.bindVertexArray(null);

        return vao;
    };

    // 箱モデルの生成
    function createBox(gl, program) {
        var vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        // 頂点バッファ
        var vertex_data = new Float32Array([
         // x     y     z     R   G   B
          -1.0, -1.0, -1.0,  1.0,  0,  0,// 面0
          -1.0, -1.0, +1.0,  1.0,  0,  0,
          -1.0, +1.0, -1.0,  1.0,  0,  0,
          -1.0, +1.0, +1.0,  1.0,  0,  0,
          -1.0, -1.0, -1.0,    0,1.0,  0,// 面1
          +1.0, -1.0, -1.0,    0,1.0,  0,
          -1.0, -1.0, +1.0,    0,1.0,  0,
          +1.0, -1.0, +1.0,    0,1.0,  0,
          -1.0, -1.0, -1.0,    0,  0,1.0,// 面2
          -1.0, +1.0, -1.0,    0,  0,1.0,
          +1.0, -1.0, -1.0,    0,  0,1.0,
          +1.0, +1.0, -1.0,    0,  0,1.0,
          +1.0, -1.0, -1.0,  1.0,1.0,  0,// 面3
          +1.0, +1.0, -1.0,  1.0,1.0,  0,
          +1.0, -1.0, +1.0,  1.0,1.0,  0,
          +1.0, +1.0, +1.0,  1.0,1.0,  0,
          -1.0, +1.0, -1.0,  1.0,  0,1.0,// 面4
          -1.0, +1.0, +1.0,  1.0,  0,1.0,
          +1.0, +1.0, -1.0,  1.0,  0,1.0,
          +1.0, +1.0, +1.0,  1.0,  0,1.0,
          -1.0, -1.0, +1.0,    0,1.0,1.0,// 面5
          +1.0, -1.0, +1.0,    0,1.0,1.0,
          -1.0, +1.0, +1.0,    0,1.0,1.0,
          +1.0, +1.0, +1.0,    0,1.0,1.0,
        ]);   
        const vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertex_data), gl.STATIC_DRAW);

        var posAttr = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(posAttr);
        gl.vertexAttribPointer(posAttr, 3, gl.FLOAT, false, 4*6, 0);

        var colAttr = gl.getAttribLocation(program, 'color');
        gl.enableVertexAttribArray(colAttr);
        gl.vertexAttribPointer(colAttr, 3, gl.FLOAT, false, 4*6, 4*3);

        // インデックスバッファ
        var index_data = new Uint8Array([
          0+0,  0+1,  0+2,   0+3,  0+2,  0+1, // 面0
          4+0,  4+1,  4+2,   4+3,  4+2,  4+1, // 面1
          8+0,  8+1,  8+2,   8+3,  8+2,  8+1, // 面2
         12+0, 12+1, 12+2,  12+3, 12+2, 12+1, // 面3
         16+0, 16+1, 16+2,  16+3, 16+2, 16+1, // 面4
         20+0, 20+1, 20+2,  20+3, 20+2, 20+1, // 面5
        ]);
        
        var indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index_data, gl.STATIC_DRAW);

        gl.bindVertexArray(null);

        return vao;
    };
    
    // デバッグ用平面モデルの生成
    function createDebugPlane(gl, program) {
        var vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        var vertex_data = new Float32Array([
         // x    y     z      u    v 
          -0.5, 0.5, -1.0,   1.0, 0.0,
          -0.5, 1.0, -1.0,   1.0, 1.0,
          -1.0, 0.5, -1.0,   0.0, 0.0,
          -1.0, 1.0, -1.0,   0.0, 1.0,
        ]);

        const vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertex_data, gl.STATIC_DRAW);

        var posAttr = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(posAttr);
        gl.vertexAttribPointer(posAttr, 3, gl.FLOAT, false, 4*5, 0);

        var colAttr = gl.getAttribLocation(program, 'uv');
        gl.enableVertexAttribArray(colAttr);
        gl.vertexAttribPointer(colAttr, 2, gl.FLOAT, false, 4*5, 4*3);

        var index_data = new Uint8Array([
          0,  1,  2,   3,  2,  1,
        ]);
        var indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index_data, gl.STATIC_DRAW);

        gl.bindVertexArray(null);

        return vao;
    };


})();
