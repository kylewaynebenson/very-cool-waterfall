import gulp from 'gulp';
import sass from 'gulp-sass';
import * as dartSass from 'sass';
import autoprefixer from 'gulp-autoprefixer';
import cleanCSS from 'gulp-clean-css';
import terser from 'gulp-terser';
import browserSync from 'browser-sync';

const sassCompiler = sass(dartSass);
const bs = browserSync.create();

// Compile SCSS
function style() {
    return gulp.src('./src/scss/**/*.scss')
        .pipe(sassCompiler().on('error', sassCompiler.logError))
        .pipe(autoprefixer())
        .pipe(cleanCSS())
        .pipe(gulp.dest('./dist/css'))
        .pipe(bs.stream());
}


// Minify JS
function script() {
    return gulp.src('./src/js/**/*.js')
        .pipe(terser())
        .pipe(gulp.dest('./dist/js'))
        .pipe(bs.stream());
}

// Watch files
function watch() {
    bs.init({
        server: {
            baseDir: './'
        }
    });
    gulp.watch('./src/scss/**/*.scss', style);
    gulp.watch('./src/js/**/*.js', script);
    gulp.watch('./*.html').on('change', bs.reload);
}

export { style, script, watch };
export default gulp.series(style, script, watch);
